import path from 'node:path'
import { execFile } from 'node:child_process'
import type { McpCatalogEntry, McpServerConfig, McpStatus, McpTool } from '@shared/types'
import { McpClient, StdioTransport, HttpTransport } from './client'
import { CATALOG } from './catalog'
import { childEnv } from '../terminal'
import { resolveInside } from '../fs/workspace'
import { nowIso, readJson, shortId, writeJson } from '../util'

export interface McpTestResult {
  ok: boolean
  at: string
  tools: number
  connectMs?: number
  capability?: { tool: string; ok: boolean; excerpt: string }
  error?: string
}

interface Stored {
  servers: McpServerConfig[]
  tests: Record<string, McpTestResult>
}

interface Instance {
  key: string
  serverId: string
  client: McpClient | null
  status: McpStatus
  logs: string[]
  starting?: Promise<void>
}

export interface McpManagerDeps {
  appDir: string
  /** absolute entry script for bundled servers, e.g. filesystem -> .../server-filesystem/dist/index.js */
  bundledEntry(name: string): string | null
  getSecret(name: string): Promise<string | null>
  setSecret(name: string, value: string): Promise<void>
  onChange(): void
}

const PATH_ARG = /(^|_)(path|paths|file|files|dir|directory|repo_path|root|source|destination|target)$/i

export function sanitizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 28)
}

/**
 * Manages MCP server configs, lifecycle (on-demand start, crash detection, stop), logs, tests and tool calls.
 * Servers never start with the app; they start when enabled AND needed (a run, a test, or Connect).
 */
export class McpManager {
  private file: string
  private data: Stored | null = null
  private inst = new Map<string, Instance>()

  constructor(private deps: McpManagerDeps) {
    this.file = path.join(deps.appDir, 'mcp', 'servers.json')
  }

  catalog(): McpCatalogEntry[] {
    return CATALOG
  }

  async load(): Promise<Stored> {
    if (!this.data) {
      this.data = await readJson<Stored>(this.file, { servers: [], tests: {} })
      this.data.tests ??= {}
    }
    return this.data
  }

  private async save(): Promise<void> {
    await writeJson(this.file, this.data)
    this.deps.onChange()
  }

  async list(): Promise<{ servers: McpServerConfig[]; tests: Record<string, McpTestResult>; status: McpStatus[] }> {
    const d = await this.load()
    // never return secret env values
    const servers = d.servers.map((s) => ({ ...s, env: Object.fromEntries(Object.keys(s.env ?? {}).map((k) => [k, s.env![k] ? '(stored securely)' : ''])) }))
    return { servers, tests: d.tests, status: [...this.inst.values()].map((i) => ({ ...i.status, id: i.key })) }
  }

  async installFromCatalog(catalogId: string): Promise<McpServerConfig> {
    const entry = CATALOG.find((c) => c.id === catalogId)
    if (!entry?.install) throw new Error('This catalogue entry cannot be installed from Dahl Studio.')
    const d = await this.load()
    const existing = d.servers.find((s) => s.catalogId === catalogId)
    if (existing) return existing
    const cfg: McpServerConfig = { ...entry.install, env: Object.fromEntries(Object.keys(entry.install.env ?? {}).map((k) => [k, ''])), id: catalogId, enabled: false, policy: 'ask', custom: false }
    d.servers.push(cfg)
    await this.save()
    return cfg
  }

  async addCustom(cfg: Omit<McpServerConfig, 'id' | 'custom' | 'enabled'>): Promise<McpServerConfig> {
    if (cfg.transport === 'stdio' && !cfg.command?.trim()) throw new Error('Command is required for STDIO servers')
    if (cfg.transport === 'http' && !/^https?:\/\//.test(cfg.url ?? '')) throw new Error('A valid http(s) URL is required')
    const d = await this.load()
    const id = `custom-${sanitizeName(cfg.name || 'server').toLowerCase()}-${shortId().slice(0, 4)}`
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(cfg.env ?? {})) {
      if (v) await this.deps.setSecret(`mcp:${id}:${k}`, v)
      env[k] = v ? 'secret' : ''
    }
    const full: McpServerConfig = { ...cfg, env, id, custom: true, enabled: false, policy: 'ask' }
    d.servers.push(full)
    await this.save()
    return full
  }

  async update(id: string, patch: Partial<Pick<McpServerConfig, 'enabled' | 'policy' | 'args' | 'url'>> & { env?: Record<string, string> }): Promise<void> {
    const d = await this.load()
    const s = d.servers.find((x) => x.id === id)
    if (!s) throw new Error('Unknown server')
    if (patch.env) {
      for (const [k, v] of Object.entries(patch.env)) {
        if (v && v !== '(stored securely)') await this.deps.setSecret(`mcp:${id}:${k}`, v)
        s.env = { ...(s.env ?? {}), [k]: v ? 'secret' : '' }
      }
    }
    if (patch.enabled !== undefined) s.enabled = patch.enabled
    if (patch.policy) s.policy = patch.policy
    if (patch.args) s.args = patch.args
    if (patch.url) s.url = patch.url
    if (patch.enabled === false) this.stopServer(id)
    await this.save()
  }

  async remove(id: string): Promise<void> {
    this.stopServer(id)
    const d = await this.load()
    d.servers = d.servers.filter((s) => s.id !== id)
    delete d.tests[id]
    await this.save()
  }

  /** Export without secret values. */
  async exportConfig(): Promise<string> {
    const d = await this.load()
    return JSON.stringify({ mcpServers: d.servers.map((s) => ({ ...s, env: Object.fromEntries(Object.keys(s.env ?? {}).map((k) => [k, ''])) })) }, null, 2)
  }

  /** Import never enables anything: imported servers start disabled and must be reviewed. */
  async importConfig(json: string): Promise<number> {
    const parsed = JSON.parse(json)
    const list: any[] = Array.isArray(parsed?.mcpServers) ? parsed.mcpServers : Object.entries(parsed?.mcpServers ?? {}).map(([name, v]: [string, any]) => ({ name, ...v }))
    let n = 0
    for (const s of list) {
      await this.addCustom({ name: String(s.name ?? 'Imported'), transport: s.url ? 'http' : 'stdio', command: s.command, args: (s.args ?? []).map(String), url: s.url, headers: s.headers, env: {}, policy: 'ask' })
      n++
    }
    return n
  }

  async checkPrereq(command: string | undefined): Promise<string | null> {
    if (!command || command.startsWith('${bundled:')) return null
    const exe = command.split(/[\\/]/).pop()!
    return new Promise((resolve) => execFile('where', [exe], { windowsHide: true }, (err) => resolve(err ? `${exe} was not found on this computer. Install it first (see the card's requirements).` : null)))
  }

  private instKey(cfg: McpServerConfig, project: string | null): string {
    const cat = CATALOG.find((x) => x.id === cfg.catalogId)
    const usesProject = JSON.stringify([(!cfg.custom && cat?.install?.args) || cfg.args, cfg.url]).includes('${project}')
    return usesProject ? `${cfg.id}|${(project ?? '').toLowerCase()}` : cfg.id
  }

  private log(i: Instance, line: string): void {
    i.logs.push(`${new Date().toISOString().slice(11, 19)} ${line}`)
    if (i.logs.length > 500) i.logs.splice(0, i.logs.length - 500)
  }

  async start(id: string, project: string | null): Promise<Instance> {
    const d = await this.load()
    const cfg = d.servers.find((s) => s.id === id)
    if (!cfg) throw new Error('Unknown server')
    const key = this.instKey(cfg, project)
    let i = this.inst.get(key)
    if (i?.status.state === 'connected') return i
    if (i?.starting) {
      await i.starting
      return i
    }
    i = i ?? { key, serverId: id, client: null, status: { id: key, state: 'stopped', tools: [] }, logs: [] }
    this.inst.set(key, i)
    const inst = i
    inst.status = { id: key, state: 'starting', tools: [] }
    this.deps.onChange()
    inst.starting = (async () => {
      try {
        if (JSON.stringify([cfg.args, cfg.url]).includes('${project}') && !project) throw new Error('This server needs an open project')
        const sub = (s: string): string => s.split('${project}').join(project ?? '')
        let transport
        if (cfg.transport === 'http') {
          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(cfg.headers ?? {})) headers[k] = v
          transport = new HttpTransport(sub(cfg.url!), headers)
        } else {
          const pre = await this.checkPrereq(cfg.command)
          if (pre) throw new Error(pre)
          const env = childEnv() // never contains Dahl or other AI provider keys
          for (const k of Object.keys(cfg.env ?? {})) {
            const v = await this.deps.getSecret(`mcp:${cfg.id}:${k}`)
            if (v) env[k] = v
          }
          let command = cfg.command!
          // catalogue servers always use the current (pinned) catalogue arguments
          const cat = CATALOG.find((x) => x.id === cfg.catalogId)
          let args = ((!cfg.custom && cat?.install?.args) || cfg.args || []).map(sub)
          const bundled = /^\$\{bundled:([a-z-]+)\}$/.exec(command)
          if (bundled) {
            const entry = this.deps.bundledEntry(bundled[1])
            if (!entry) throw new Error(`Bundled server ${bundled[1]} is missing from this installation`)
            command = process.execPath
            args = [entry, ...args]
            env.ELECTRON_RUN_AS_NODE = '1'
          }
          this.log(inst, `starting: ${bundled ? `[bundled ${bundled[1]}]` : command} ${args.join(' ')}`)
          const work = path.join(this.deps.appDir, 'mcp', 'work')
          await (await import('node:fs')).promises.mkdir(work, { recursive: true })
          // servers run from Dahl's own folder so they do not litter the project (e.g. Playwright snapshots)
          transport = new StdioTransport(command, args, env, work, (l) => this.log(inst, l))
        }
        transport.onClose = (reason) => {
          this.log(inst, `disconnected: ${reason}`)
          inst.client = null
          inst.status = { ...inst.status, state: 'error', error: `Server ${reason}. It will be restarted on next use.` }
          this.deps.onChange()
        }
        const client = new McpClient(transport)
        const t0 = Date.now()
        await client.initialize()
        const tools = await client.listTools()
        inst.client = client
        inst.status = { id: key, state: 'connected', tools, pid: transport instanceof StdioTransport ? transport.pid : undefined, startedAt: nowIso() }
        this.log(inst, `connected in ${Date.now() - t0} ms, ${tools.length} tools`)
      } catch (e) {
        inst.client?.transport.close()
        inst.client = null
        inst.status = { id: key, state: 'error', tools: [], error: (e as Error).message }
        this.log(inst, `error: ${(e as Error).message}`)
      } finally {
        inst.starting = undefined
        this.deps.onChange()
      }
    })()
    await inst.starting
    return inst
  }

  stopServer(id: string): void {
    for (const [k, i] of this.inst) {
      if (i.serverId !== id) continue
      i.client?.transport.close()
      i.client = null
      i.status = { id: k, state: 'stopped', tools: [] }
      this.log(i, 'stopped by user')
    }
    this.deps.onChange()
  }

  stopAll(): void {
    for (const i of this.inst.values()) i.client?.transport.close()
  }

  logs(id: string): string[] {
    return [...this.inst.values()].filter((i) => i.serverId === id).flatMap((i) => i.logs)
  }

  /** Enabled servers' tools for a project; starts enabled servers on demand (bounded wait). */
  async toolsFor(project: string): Promise<{ serverId: string; serverName: string; policy: McpServerConfig['policy']; tool: McpTool; fnName: string }[]> {
    const d = await this.load()
    const out: { serverId: string; serverName: string; policy: McpServerConfig['policy']; tool: McpTool; fnName: string }[] = []
    await Promise.all(
      d.servers.filter((s) => s.enabled).map(async (s) => {
        const i = await Promise.race([this.start(s.id, project), new Promise<null>((r) => setTimeout(() => r(null), 45000))])
        if (!i || i.status.state !== 'connected') return
        for (const t of i.status.tools) out.push({ serverId: s.id, serverName: s.name, policy: s.policy, tool: t, fnName: `mcp__${sanitizeName(s.id)}__${sanitizeName(t.name)}`.slice(0, 64) })
      })
    )
    return out
  }

  /** Enforce the project boundary on path-like arguments before any MCP call. */
  async checkArgs(project: string, args: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(args ?? {})) {
      const vals = Array.isArray(v) ? v : [v]
      for (const val of vals) {
        if (typeof val !== 'string' || !PATH_ARG.test(k) || /^[a-z]+:\/\//i.test(val)) continue
        await resolveInside(project, val) // throws PathBoundaryError if outside
      }
    }
  }

  async call(serverId: string, project: string, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; images: { mediaType: string; data: string }[] }> {
    await this.checkArgs(project, args)
    let i = await this.start(serverId, project)
    if (!i.client) throw new Error(i.status.error ?? 'Server not connected')
    try {
      return await i.client.callTool(tool, args)
    } catch (e) {
      // one automatic restart if the server crashed mid-call
      if (!i.client) {
        i = await this.start(serverId, project)
        if (i.client) return i.client.callTool(tool, args)
      }
      throw e
    }
  }

  /** Real test: connect, list tools and (when defined) run the capability test with real arguments. */
  async test(id: string, project: string | null): Promise<McpTestResult> {
    const d = await this.load()
    const cfg = d.servers.find((s) => s.id === id)
    if (!cfg) throw new Error('Unknown server')
    const t0 = Date.now()
    const i = await this.start(id, project)
    let result: McpTestResult
    if (i.status.state !== 'connected' || !i.client) result = { ok: false, at: nowIso(), tools: 0, error: i.status.error }
    else {
      result = { ok: true, at: nowIso(), tools: i.status.tools.length, connectMs: Date.now() - t0 }
      const ct = CATALOG.find((c) => c.id === cfg.catalogId)?.capabilityTest
      if (ct) {
        const args = JSON.parse(JSON.stringify(ct.args).split('${project}').join((project ?? '').replace(/\\/g, '\\\\')))
        try {
          const r = await i.client.callTool(ct.tool, args, 90000)
          const ok = !r.isError && r.text.includes(ct.expect)
          result.capability = { tool: ct.tool, ok, excerpt: r.text.slice(0, 400) }
          result.ok = ok
        } catch (e) {
          result.capability = { tool: ct.tool, ok: false, excerpt: (e as Error).message }
          result.ok = false
        }
      }
    }
    d.tests[id] = result
    await this.save()
    return result
  }
}
