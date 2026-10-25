import { promises as fsp } from 'node:fs'
import type { PendingApproval, PlanStep, RunState, Settings } from '@shared/types'
import { listTree, readText, readTextOrNull, resolveInside, searchText, writeText, PathBoundaryError } from '../fs/workspace'
import type { ProjectStore } from '../store/projectStore'
import { redact } from '../util'
import { mediaTypeFor } from './history'
import type { RunnerDeps, McpToolRef } from './runner'
import type { RunResult } from '../terminal'

export interface ToolResult {
  ok: boolean
  text: string
  images?: { mediaType: string; data: string; name: string }[]
}

export interface ExecCtx {
  run: RunState
  store: ProjectStore
  deps: RunnerDeps
  signal: AbortSignal
  agentId: string
  agentName: string
  ownedFiles: string[]
  leases: Map<string, string>
  images: Map<string, { mediaType: string; data: string }>
  mcpTools: McpToolRef[]
  turn: { changed: Set<string>; commands: { command: string; exitCode: number | null }[]; memories: number }
  approve(a: Omit<PendingApproval, 'id' | 'runId' | 'project'>): Promise<{ approved: boolean; feedback?: string }>
  emitPlan(steps: PlanStep[]): void
  onChanged(): void
  status(text: string): void
}

async function checkLease(c: ExecCtx, rel: string): Promise<string | null> {
  const key = rel.replace(/\\/g, '/').toLowerCase()
  const owner = c.leases.get(key)
  if (owner && owner !== c.agentId) return `${rel} is owned by another agent (${owner}) in this task. Report back instead of editing it.`
  c.leases.set(key, c.agentId)
  return null
}

async function applyWrite(c: ExecCtx, rel: string, before: string | null, after: string, reason: string | undefined, settings: Settings, forceAsk: boolean): Promise<ToolResult> {
  if (before === after) return { ok: true, text: 'No change needed (content identical).' }
  if (!settings.autoApproveWrites || forceAsk) {
    const d = await c.approve({ kind: 'write', agent: c.agentName, path: rel, before: before ?? '', after, reason })
    if (!d.approved) return { ok: false, text: `User rejected the change to ${rel}.${d.feedback ? ` Feedback: ${d.feedback}` : ''}` }
  }
  if (!(rel in c.run.backups)) c.run.backups[rel] = before
  await writeText(c.run.project, rel, after)
  c.turn.changed.add(rel)
  if (!c.run.changedFiles.includes(rel)) c.run.changedFiles.push(rel)
  c.onChanged()
  return { ok: true, text: `Applied change to ${rel} (${after.split('\n').length} lines).` }
}

export async function execTool(c: ExecCtx, name: string, rawArgs: string, allowed: string[]): Promise<ToolResult> {
  const root = c.run.project
  if (!allowed.includes(name)) return { ok: false, text: `Tool ${name} is not available to this agent in ${c.run.mode} mode.` }
  let a: any
  try {
    a = JSON.parse(rawArgs || '{}')
  } catch {
    return {
      ok: false,
      text: 'Your tool call arguments were not valid JSON - most likely the output was cut off because it was too long. Split large content: create the file with write_file (under ~250 lines), then add the rest with append_file in several calls.'
    }
  }
  if (a?._invalid_arguments) return { ok: false, text: 'Previous arguments were invalid; re-issue the call with smaller content.' }
  const settings = await c.deps.getSettings()
  try {
    switch (name) {
      case 'list_dir': {
        const nodes = await listTree(root, a.path ?? '', 1)
        return { ok: true, text: nodes.map((n) => n.path + (n.dir ? '/' : '')).join('\n') || '(empty)' }
      }
      case 'read_file': {
        const text = await readText(root, a.path)
        const lines = text.split(/\r?\n/)
        const s = Math.max(1, a.start_line ?? 1)
        const e = Math.min(lines.length, a.end_line ?? Math.min(lines.length, s + 999))
        return { ok: true, text: `${a.path} (lines ${s}-${e} of ${lines.length})\n${lines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join('\n')}` }
      }
      case 'search': {
        const hits = await searchText(root, a.query, { regex: !!a.regex, glob: a.glob })
        return { ok: true, text: hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n') || 'No matches.' }
      }
      case 'update_plan': {
        const steps: PlanStep[] = (a.steps ?? []).map((s: PlanStep) => ({ title: String(s.title), status: s.status }))
        c.run.plan = steps
        c.emitPlan(steps)
        return { ok: true, text: 'Plan updated.' }
      }
      case 'remember': {
        const text = redact(String(a.text ?? ''), await c.deps.secrets())
        if (!text.trim()) return { ok: false, text: 'Nothing to remember.' }
        await c.store.addMemory(text, Array.isArray(a.tags) ? a.tags.map(String) : [], `run:${c.run.id}`)
        c.turn.memories++
        return { ok: true, text: 'Saved to project memory.' }
      }
      case 'write_file':
      case 'append_file':
      case 'edit_file': {
        await resolveInside(root, a.path)
        const lease = await checkLease(c, a.path)
        if (lease) return { ok: false, text: lease }
        const before = await readTextOrNull(root, a.path)
        let after: string
        if (name === 'write_file') after = String(a.content ?? '')
        else if (name === 'append_file') after = (before ?? '') + String(a.content ?? '')
        else {
          if (before === null) return { ok: false, text: `${a.path} does not exist. Use write_file to create it.` }
          const count = before.split(a.old_string).length - 1
          if (!a.old_string || count === 0) return { ok: false, text: 'old_string not found. Read the file again and copy the exact text.' }
          if (count > 1) return { ok: false, text: `old_string matches ${count} times; include more context to make it unique.` }
          after = before.replace(a.old_string, () => a.new_string)
        }
        // appends to a file this turn already created/approved don't need a second approval
        const alreadyApproved = name === 'append_file' && c.turn.changed.has(a.path)
        return applyWrite(c, a.path, before, after, a.reason, alreadyApproved ? { ...settings, autoApproveWrites: true } : settings, false)
      }
      case 'run_command': {
        let command = String(a.command ?? '').trim()
        if (!command) return { ok: false, text: 'Empty command.' }
        command = unwrapPowershell(command)
        if (!settings.autoApproveCommands) {
          const d = await c.approve({ kind: 'command', agent: c.agentName, command, reason: a.reason })
          if (!d.approved) return { ok: false, text: `User declined to run the command.${d.feedback ? ` Feedback: ${d.feedback}` : ''}` }
        }
        const timeout = Math.min(Math.max(Number(a.timeout_seconds) || 120, 5), 900) * 1000
        const r: RunResult = await c.deps.runCommand(command, root, timeout, c.signal)
        c.turn.commands.push({ command, exitCode: r.exitCode })
        c.run.commandsRun.push({ command, exitCode: r.exitCode })
        const out = r.output.length > 10000 ? r.output.slice(0, 4000) + '\n...[output truncated]...\n' + r.output.slice(-5500) : r.output
        return { ok: r.exitCode === 0, text: `exit code: ${r.exitCode}${r.timedOut ? ' (timed out)' : ''}\n${out || '(no output)'}` }
      }
      case 'web_search': {
        if (!c.deps.web) return { ok: false, text: 'Web research is not available.' }
        const res = await c.deps.web.search(String(a.query), Math.min(Number(a.max_results) || 8, 15), c.signal)
        if (!res.length) return { ok: true, text: 'No results.' }
        return { ok: true, text: `Search results for "${a.query}" (untrusted web content):\n` + res.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n') }
      }
      case 'web_fetch': {
        if (!c.deps.web) return { ok: false, text: 'Web research is not available.' }
        const r = await c.deps.web.fetch(String(a.url), c.signal)
        return { ok: r.status < 400, text: `Fetched ${r.url} (HTTP ${r.status})${r.title ? ` - ${r.title}` : ''}. Untrusted content follows:\n<web_content>\n${r.text}${r.truncated ? '\n[truncated]' : ''}\n</web_content>` }
      }
      case 'view_image':
      case 'analyze_image': {
        const img = await loadImage(c, String(a.path))
        if (!img) return { ok: false, text: `Image not found: ${a.path}. Use a project-relative path or the name of an attached image.` }
        if (name === 'view_image') {
          const vision = c.deps.modelVision ? await c.deps.modelVision(c.run.model) : false
          if (!vision) return { ok: false, text: 'The selected model cannot see images. Use analyze_image instead.' }
          return { ok: true, text: `Image ${a.path} attached below.`, images: [{ ...img, name: a.path }] }
        }
        if (!c.deps.analyzeImage) return { ok: false, text: 'Image analysis is not available.' }
        c.status(`Analysing image ${a.path}`)
        return { ok: true, text: await c.deps.analyzeImage(String(a.path), img.mediaType, img.data, c.signal) }
      }
    }
    if (name.startsWith('mcp__')) return execMcp(c, name, a, settings)
    return { ok: false, text: `Unknown tool ${name}` }
  } catch (e) {
    if (e instanceof PathBoundaryError) return { ok: false, text: e.message }
    return { ok: false, text: `Error: ${(e as Error).message}` }
  }
}

async function execMcp(c: ExecCtx, name: string, args: Record<string, unknown>, _s: Settings): Promise<ToolResult> {
  const ref = c.mcpTools.find((t) => t.fnName === name)
  if (!ref || !c.deps.mcp) return { ok: false, text: `MCP tool ${name} is not connected.` }
  const needsAsk = ref.policy === 'ask' || (ref.policy === 'readonly' && !ref.tool.readOnly)
  if (needsAsk) {
    const d = await c.approve({ kind: 'mcp', agent: c.agentName, tool: `${ref.serverName} / ${ref.tool.name}`, args: JSON.stringify(args, null, 2).slice(0, 4000) })
    if (!d.approved) return { ok: false, text: `User declined the ${ref.tool.name} call.${d.feedback ? ` Feedback: ${d.feedback}` : ''}` }
  }
  const r = await c.deps.mcp.call(ref.serverId, c.run.project, ref.tool.name, args)
  return { ok: !r.isError, text: `MCP ${ref.serverName}/${ref.tool.name} result (untrusted):\n${r.text.slice(0, 20000)}`, images: r.images.map((im, i) => ({ ...im, name: `${ref.tool.name}-${i}` })) }
}

async function loadImage(c: ExecCtx, p: string): Promise<{ mediaType: string; data: string } | null> {
  const att = c.images.get(p)
  if (att) return att
  const mt = mediaTypeFor(p)
  if (!mt) return null
  const abs = await resolveInside(c.run.project, p)
  try {
    const buf = await fsp.readFile(abs)
    if (buf.length > 15 * 1024 * 1024) return null
    return { mediaType: mt, data: buf.toString('base64') }
  } catch {
    return null
  }
}

/** Models often wrap commands as `powershell -Command "..."`; the outer PowerShell would expand $vars inside the quotes. Unwrap it. */
export function unwrapPowershell(cmd: string): string {
  const m = /^(?:powershell|pwsh)(?:\.exe)?\s+(?:-NoProfile\s+|-NoLogo\s+|-NonInteractive\s+|-ExecutionPolicy\s+\w+\s+)*-(?:Command|c)\s+(["'])([\s\S]*)\1\s*$/i.exec(cmd.trim())
  return m ? m[2] : cmd
}
