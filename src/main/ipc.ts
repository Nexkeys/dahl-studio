import { app, dialog, ipcMain, safeStorage, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Attachment, KeySlot, MemoryEntry, ReasoningProfile, Settings, StartRunRequest, StorageReport } from '@shared/types'
import { APP_DIR, LOG_FILE, health, keyInfos, log, mcp, models, procs, reasoning, runner, send, settings, usage, vault, win } from './services'
import { createEntry, IGNORED_DIRS, listTree, readText, resolveInside, searchText, toRel, writeText } from './fs/workspace'
import { ProjectStore } from './store/projectStore'
import { gitBranch, gitCommit, gitInitOrRemote, gitPush, gitShowHead, gitStatus } from './git'
import { dirSize, redact, shortId } from './util'
import { mediaTypeFor } from './agent/history'
import { checkForUpdates, getUpdateStatus, installUpdate } from './updater'

async function assertProject(project: string): Promise<string> {
  const s = await settings.get()
  const p = path.resolve(project)
  if (!s.openProjects.some((o) => path.resolve(o).toLowerCase() === p.toLowerCase())) throw new Error('Project is not open in Dahl Studio.')
  return p
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...(args as A)) }
    } catch (e) {
      const message = redact((e as Error)?.message ?? String(e), await vault.allValues().catch(() => []))
      void log('error', `${channel}: ${message}`)
      return { ok: false, error: message }
    }
  })
}

/** Read a file or folder (user-chosen via dialog, read-only) into a bounded attachment. */
async function makeAttachment(abs: string, root?: string): Promise<Attachment> {
  const st = await fs.stat(abs)
  const name = root ? toRel(root, abs) || path.basename(abs) : path.basename(abs)
  if (st.isDirectory()) {
    const lines: string[] = []
    const files: string[] = []
    const walk = async (d: string, depth: number): Promise<void> => {
      if (depth > 4 || lines.length > 400) return
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        if (IGNORED_DIRS.has(e.name) || e.name === '.dahl') continue
        const p = path.join(d, e.name)
        lines.push(`${'  '.repeat(depth)}${e.name}${e.isDirectory() ? '/' : ''}`)
        if (e.isDirectory()) await walk(p, depth + 1)
        else files.push(p)
      }
    }
    await walk(abs, 0)
    let budget = 120_000
    const bodies: string[] = []
    for (const f of files) {
      if (budget <= 0) break
      const s = await fs.stat(f)
      if (s.size > 200_000 || mediaTypeFor(f)) continue
      const buf = await fs.readFile(f)
      if (buf.subarray(0, 4000).includes(0)) continue
      const text = buf.toString('utf8').slice(0, Math.min(budget, 30_000))
      budget -= text.length
      bodies.push(`--- ${path.relative(abs, f)} ---\n${text}`)
    }
    return { id: shortId(), kind: 'folder', name, text: `Tree:\n${lines.join('\n')}\n\nContents (${bodies.length} of ${files.length} files, bounded):\n${bodies.join('\n\n')}`, bytes: st.size }
  }
  const mt = mediaTypeFor(abs)
  if (mt) {
    if (st.size > 15 * 1024 * 1024) throw new Error('Image larger than 15 MB')
    return { id: shortId(), kind: 'image', name, mediaType: mt, data: (await fs.readFile(abs)).toString('base64'), bytes: st.size }
  }
  if (st.size > 1024 * 1024) throw new Error(`${name} is larger than 1 MB`)
  const buf = await fs.readFile(abs)
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${name} looks like a binary file`)
  return { id: shortId(), kind: 'file', name, text: buf.toString('utf8'), bytes: st.size }
}

export function registerIpc(): void {
  handle('settings:get', () => settings.get())
  handle('settings:update', async (patch: Partial<Settings>) => {
    const { openProjects: _o, ...safe } = patch
    return settings.update(safe)
  })

  // ---- keys & models ----
  handle('keys:list', () => keyInfos())
  handle('keys:set', async (slot: KeySlot, key: string | null, name?: string) => {
    if (key !== null) await vault.set(slot, key)
    if (name !== undefined) {
      const s = await settings.get()
      await settings.update({ keyNames: { ...s.keyNames, [slot]: name.slice(0, 40) || s.keyNames[slot] } })
    }
    health[slot] = { health: 'unknown' }
    return keyInfos()
  })
  handle('keys:clear', async (slot: KeySlot) => {
    await vault.clear(slot)
    health[slot] = { health: 'unknown' }
    void models.refresh().catch(() => {})
    return keyInfos()
  })
  handle('keys:test', async (slot: KeySlot) => {
    const r = await models.testKey(slot)
    send('keys:changed', await keyInfos())
    return r
  })
  handle('usage:get', () => usage.get())
  handle('usage:reset', () => usage.reset())
  handle('models:list', () => models.list())
  handle('models:refresh', () => models.refresh())

  // ---- projects ----
  handle('project:pick', async () => {
    const r = await dialog.showOpenDialog(win.current!, { properties: ['openDirectory'], title: 'Open project folder' })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('project:open', async (dir: string) => {
    if (!(await fs.stat(dir)).isDirectory()) throw new Error('Not a folder')
    const s = await settings.get()
    const abs = path.resolve(dir)
    const list = s.openProjects.filter((p) => path.resolve(p).toLowerCase() !== abs.toLowerCase())
    if (list.length >= 4) throw new Error('Close a project first (max 4 open).')
    await settings.update({ openProjects: [...list, abs], activeProject: abs })
    await new ProjectStore(abs).markInterrupted()
    return settings.get()
  })
  handle('project:close', async (dir: string) => {
    const s = await settings.get()
    if (runner.isActive(dir)) throw new Error('A task is running in this project. Pause or cancel it first.')
    const list = s.openProjects.filter((p) => path.resolve(p).toLowerCase() !== path.resolve(dir).toLowerCase())
    return settings.update({ openProjects: list, activeProject: list[list.length - 1] ?? null })
  })

  // ---- files ----
  handle('fs:tree', async (project: string, rel: string) => listTree(await assertProject(project), rel, 1))
  handle('fs:read', async (project: string, rel: string) => readText(await assertProject(project), rel))
  handle('fs:write', async (project: string, rel: string, content: string) => writeText(await assertProject(project), rel, content))
  handle('fs:create', async (project: string, rel: string, dir: boolean) => createEntry(await assertProject(project), rel, dir))
  handle('fs:search', async (project: string, q: string) => searchText(await assertProject(project), q, { max: 300 }))
  handle('fs:reveal', async (project: string, rel: string) => shell.showItemInFolder(await resolveInside(await assertProject(project), rel)))
  handle('fs:openExternal', async (project: string, rel: string) => shell.openPath(await resolveInside(await assertProject(project), rel)))
  handle('fs:listAll', async (project: string) => {
    const root = await assertProject(project)
    const out: string[] = []
    const walk = async (d: string): Promise<void> => {
      if (out.length > 8000) return
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (IGNORED_DIRS.has(e.name) || e.name === '.dahl') continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else out.push(toRel(root, p))
      }
    }
    await walk(root)
    return out
  })
  handle('attach:pick', async (project: string | null, kind: 'file' | 'folder' | 'image') => {
    const r = await dialog.showOpenDialog(win.current!, {
      title: kind === 'folder' ? 'Attach folder' : kind === 'image' ? 'Attach image' : 'Attach files',
      defaultPath: project ?? undefined,
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
      filters: kind === 'image' ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] : undefined
    })
    if (r.canceled) return []
    const root = project && (await assertProject(project).catch(() => null))
    return Promise.all(r.filePaths.map((p) => makeAttachment(p, root && p.toLowerCase().startsWith(root.toLowerCase()) ? root : undefined)))
  })
  handle('attach:path', async (project: string, rel: string) => {
    const root = await assertProject(project)
    return makeAttachment(await resolveInside(root, rel), root)
  })

  // ---- git ----
  handle('git:status', async (project: string) => gitStatus(await assertProject(project)))
  handle('git:head', async (project: string, rel: string) => gitShowHead(await assertProject(project), rel))
  handle('git:commit', async (project: string, message: string, files: string[] | 'all') => gitCommit(await assertProject(project), message, files))
  handle('git:branch', async (project: string, name: string) => gitBranch(await assertProject(project), name))
  handle('git:push', async (project: string) => gitPush(await assertProject(project)))
  handle('git:remote', async (project: string, url?: string) => gitInitOrRemote(await assertProject(project), url))

  // ---- terminal ----
  handle('term:start', async (id: string, command: string, project: string) => {
    procs.start(id, command, await assertProject(project), (e) => send('term:event', e))
    return true
  })
  handle('term:stop', (id: string) => procs.stop(id))

  // ---- agent ----
  handle('agent:start', async (req: StartRunRequest) => {
    await assertProject(req.project)
    return runner.start(req)
  })
  handle('agent:pause', (project: string) => runner.pause(project))
  handle('agent:cancel', (project: string) => runner.cancel(project))
  handle('agent:checkpoint', (project: string) => runner.checkpoint(project))
  handle('agent:approve', (id: string, approved: boolean, feedback?: string) => runner.resolveApproval(id, approved, feedback))
  handle('agent:pending', () => runner.pendingApprovals())
  handle('agent:active', (project: string) => runner.activeRunId(project))
  handle('agent:agents', () => runner.agents())
  handle('agent:revert', async (project: string, id: string) => runner.revert(await assertProject(project), id))
  handle('agent:runs', async (project: string) => new ProjectStore(await assertProject(project)).listRuns())
  handle('agent:loadRun', async (project: string, id: string) => new ProjectStore(await assertProject(project)).loadRun(id))
  handle('agent:deleteRun', async (project: string, id: string) => {
    if (runner.activeRunId(project) === id) throw new Error('Task is running.')
    return new ProjectStore(await assertProject(project)).deleteRun(id)
  })

  // ---- memory ----
  handle('memory:list', async (project: string) => new ProjectStore(await assertProject(project)).listMemory())
  handle('memory:save', async (project: string, entries: MemoryEntry[]) => new ProjectStore(await assertProject(project)).saveMemory(entries))
  handle('memory:add', async (project: string, text: string, tags: string[]) => new ProjectStore(await assertProject(project)).addMemory(text, tags, 'user'))

  // ---- reasoning panel ----
  handle('reasoning:get', () => reasoning.get())
  handle('reasoning:save', (p: ReasoningProfile) => reasoning.save(p))
  handle('reasoning:remove', (id: string) => reasoning.remove(id))
  handle('reasoning:reset', (id: string) => reasoning.reset(id))
  handle('reasoning:activate', (id: string) => reasoning.setActive(id))
  handle('reasoning:projectOverride', async (project: string, id: string | null) => {
    const s = await settings.get()
    const map = { ...s.projectReasoning }
    if (id) map[project] = id
    else delete map[project]
    return settings.update({ projectReasoning: map })
  })

  // ---- MCP ----
  handle('mcp:catalog', () => mcp.catalog())
  handle('mcp:list', () => mcp.list())
  handle('mcp:install', (catalogId: string) => mcp.installFromCatalog(catalogId))
  handle('mcp:addCustom', (cfg: Parameters<typeof mcp.addCustom>[0]) => mcp.addCustom(cfg))
  handle('mcp:update', (id: string, patch: Parameters<typeof mcp.update>[1]) => mcp.update(id, patch))
  handle('mcp:remove', (id: string) => mcp.remove(id))
  handle('mcp:connect', async (id: string, project: string | null) => (await mcp.start(id, project)).status)
  handle('mcp:stop', (id: string) => mcp.stopServer(id))
  handle('mcp:test', (id: string, project: string | null) => mcp.test(id, project))
  handle('mcp:logs', (id: string) => mcp.logs(id))
  handle('mcp:export', () => mcp.exportConfig())
  handle('mcp:import', (json: string) => mcp.importConfig(json))
  handle('mcp:prereq', (cmd: string) => mcp.checkPrereq(cmd))

  // ---- storage & logs ----
  handle('storage:report', async (): Promise<StorageReport> => {
    const s = await settings.get()
    const sz = (p: string) => dirSize(path.join(APP_DIR, p))
    const items: StorageReport['items'] = [
      { label: 'Settings and model catalogue', path: APP_DIR, bytes: (await fs.stat(path.join(APP_DIR, 'settings.json')).then((x) => x.size, () => 0)) + (await fs.stat(path.join(APP_DIR, 'models.json')).then((x) => x.size, () => 0)) },
      { label: 'Encrypted API keys and connector secrets', path: path.join(APP_DIR, 'secrets'), bytes: await sz('secrets') },
      { label: 'Usage measurements', path: path.join(APP_DIR, 'usage'), bytes: await sz('usage') },
      { label: 'MCP connector configuration', path: path.join(APP_DIR, 'mcp'), bytes: await sz('mcp') },
      { label: 'Logs', path: path.join(APP_DIR, 'logs'), bytes: await sz('logs') },
      { label: 'Chromium cache (Electron)', path: path.join(APP_DIR, 'Cache'), bytes: await sz('Cache') },
      { label: 'Bundled MCP servers (in the app install)', path: path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'node_modules'), bytes: await dirSize(path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'node_modules')) }
    ]
    for (const p of s.openProjects) items.push({ label: `Project data: ${path.basename(p)}/.dahl`, path: path.join(p, '.dahl'), bytes: await dirSize(path.join(p, '.dahl')) })
    return { appDataDir: APP_DIR, items }
  })
  handle('storage:open', async (p: string) => {
    const s = await settings.get()
    const allowed = p.startsWith(APP_DIR) || p.startsWith(app.getAppPath().replace(/app\.asar$/, '')) || s.openProjects.some((o) => p.startsWith(o))
    if (!allowed) throw new Error('Not a Dahl Studio location')
    await fs.mkdir(p, { recursive: true }).catch(() => {})
    return shell.openPath(p)
  })
  handle('storage:clearLogs', async () => {
    await fs.rm(path.join(APP_DIR, 'logs'), { recursive: true, force: true })
    return true
  })
  handle('logs:app', async () => {
    const raw = await fs.readFile(LOG_FILE, 'utf8').catch(() => '')
    return raw.split('\n').filter(Boolean).slice(-500).map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return { at: '', level: 'info', msg: l }
      }
    })
  })
  handle('notify:test', async () => (await import('./notify')).testNotification())
  handle('update:status', () => getUpdateStatus())
  handle('update:check', () => checkForUpdates())
  handle('update:install', () => installUpdate())
  handle('app:info', () => ({
    version: app.getVersion(), appDataDir: APP_DIR, encryption: safeStorage.isEncryptionAvailable(),
    // used by the renderer's 'auto' effects mode
    gpu: String(app.getGPUFeatureStatus().gpu_compositing), cpus: os.cpus().length
  }))
}
