import path from 'node:path'
import { promises as fsp } from 'node:fs'
import type { AgentEvent, AgentInfo, AgentRole, ChatMessage, ContentPart, PendingApproval, ReasoningProfile, RunState, RunSummary, Settings, StartRunRequest, TranscriptItem, TurnSummary } from '@shared/types'
import { DahlError, type ChatRequest, type ChatResult, type StreamCallbacks } from '../dahl/client'
import { projectOutline, resolveInside, writeText } from '../fs/workspace'
import { ProjectStore } from '../store/projectStore'
import { nowIso, redact, shortId } from '../util'
import { ROLE_INFO, systemPrompt, THINKING_GUIDANCE, TOOL_DEFS, toolsFor, WRITE_ROLES } from './tools'
import { buildUserContent, compact, repairHistory, summariseTool, summary } from './history'
import { execTool, type ExecCtx, type ToolResult } from './toolExec'
import { progressFinish, progressPlan, progressStart, readProgress } from './progress'
import type { RunResult } from '../terminal'

export { repairHistory, closeDanglingToolCalls, compact } from './history'

export interface ChatBackend {
  chat(req: ChatRequest & { thinking?: StartRunRequest['thinking'] }, signal: AbortSignal, cb?: StreamCallbacks): Promise<Pick<ChatResult, 'content' | 'reasoning' | 'toolCalls'> & Partial<ChatResult> & { slot?: string }>
}
export interface McpToolRef {
  serverId: string
  serverName: string
  policy: 'ask' | 'readonly' | 'allow'
  tool: { name: string; description?: string; inputSchema?: unknown; readOnly?: boolean }
  fnName: string
}
export interface McpBridge {
  toolsFor(project: string): Promise<McpToolRef[]>
  call(serverId: string, project: string, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; images: { mediaType: string; data: string }[] }>
}
export interface RunnerDeps {
  backend: ChatBackend
  getSettings(): Promise<Settings>
  emit(e: AgentEvent): void
  runCommand(command: string, cwd: string, timeoutMs: number, signal: AbortSignal): Promise<RunResult>
  secrets(): Promise<string[]>
  reasoning?(project: string): Promise<ReasoningProfile>
  modelVision?(model: string): Promise<boolean>
  web?: {
    search(q: string, max: number, signal: AbortSignal): Promise<{ title: string; url: string; snippet: string }[]>
    fetch(url: string, signal: AbortSignal): Promise<{ url: string; status: number; title: string; text: string; truncated: boolean }>
  }
  analyzeImage?(name: string, mediaType: string, data: string, signal: AbortSignal): Promise<string>
  mcp?: McpBridge
  maxIterations?: number
}

interface RunCtl {
  run: RunState
  store: ProjectStore
  abort: AbortController
  pauseRequested: boolean
  approvals: Map<string, { approval: PendingApproval; resolve: (d: { approved: boolean; feedback?: string }) => void }>
  leases: Map<string, string>
  web: boolean
  images: Map<string, { mediaType: string; data: string }>
  mcpTools: McpToolRef[]
  turn: { start: number; toolCount: number; changed: Set<string>; commands: { command: string; exitCode: number | null }[]; memories: number }
  prompt: string
  answer: string
}
interface AgentCtx {
  info: AgentInfo
  messages: ChatMessage[]
  isLead: boolean
}
class PauseSignal extends Error {}

export class AgentRunner {
  private active = new Map<string, RunCtl>()
  constructor(private deps: RunnerDeps) {}

  private key(p: string): string {
    return path.resolve(p).toLowerCase()
  }
  isActive(p: string): boolean {
    return this.active.has(this.key(p))
  }
  activeRunId(p: string): string | null {
    return this.active.get(this.key(p))?.run.id ?? null
  }
  pendingApprovals(): PendingApproval[] {
    return [...this.active.values()].flatMap((c) => [...c.approvals.values()].map((a) => a.approval))
  }
  agents(): AgentInfo[] {
    return [...this.active.values()].flatMap((c) => c.run.agents ?? [])
  }

  async start(req: StartRunRequest): Promise<RunSummary> {
    const k = this.key(req.project)
    if (this.active.has(k)) throw new Error('A task is already running in this project. Pause or cancel it first.')
    const store = new ProjectStore(req.project)
    await store.ensure()
    let run: RunState | null = req.resumeRunId ? await store.loadRun(req.resumeRunId) : null
    if (req.resumeRunId && !run) throw new Error('Saved task state not found.')
    run ??= {
      id: shortId(), project: req.project, objective: req.prompt.slice(0, 200), mode: req.mode, model: req.model, thinking: req.thinking ?? 'off', status: 'running',
      createdAt: nowIso(), updatedAt: nowIso(), plan: [], changedFiles: [], commandsRun: [], backups: {}, messages: [], transcript: [], iterations: 0, agents: [], log: []
    }
    Object.assign(run, { mode: req.mode, model: req.model, thinking: req.thinking ?? run.thinking ?? 'off', status: 'running', lastError: undefined, iterations: 0, backups: {} })
    run.agents ??= []
    run.log ??= []
    run.changedFiles ??= []
    run.commandsRun ??= []
    repairHistory(run.messages)
    const images = new Map<string, { mediaType: string; data: string }>()
    run.messages.push({ role: 'user', content: buildUserContent(req.prompt, req.attachments ?? [], images) })
    const ctl: RunCtl = {
      run, store, abort: new AbortController(), pauseRequested: false, approvals: new Map(), leases: new Map(), web: !!req.web, images, mcpTools: [], prompt: req.prompt, answer: '',
      turn: { start: Date.now(), toolCount: 0, changed: new Set(), commands: [], memories: 0 }
    }
    this.active.set(k, ctl)
    this.addItem(ctl, { kind: 'user', text: req.prompt, attachments: (req.attachments ?? []).map((a) => ({ kind: a.kind, name: a.name })) })
    this.log(ctl, 'info', `Turn started: mode=${run.mode} model=${run.model} thinking=${run.thinking} web=${ctl.web} attachments=${req.attachments?.length ?? 0}`)
    await store.saveRun(run)
    this.emitRun(ctl)
    void this.runTurn(ctl)
    return summary(run)
  }

  pause(p: string): void {
    const c = this.active.get(this.key(p))
    if (c) c.pauseRequested = true
  }
  cancel(p: string): void {
    const c = this.active.get(this.key(p))
    if (!c) return
    c.abort.abort()
    for (const a of c.approvals.values()) a.resolve({ approved: false, feedback: 'Run cancelled' })
  }
  async checkpoint(p: string): Promise<boolean> {
    const c = this.active.get(this.key(p))
    if (!c) return false
    await c.store.saveRun(c.run)
    this.addItem(c, { kind: 'status', text: 'Checkpoint saved.' })
    return true
  }
  resolveApproval(id: string, approved: boolean, feedback?: string): boolean {
    for (const c of this.active.values()) {
      const a = c.approvals.get(id)
      if (a) {
        c.approvals.delete(id)
        a.resolve({ approved, feedback })
        return true
      }
    }
    return false
  }

  /** Restore files changed in the most recent turn (backups taken before the first change). */
  async revert(project: string, runId: string): Promise<string[]> {
    if (this.activeRunId(project) === runId) throw new Error('Task is running.')
    const store = new ProjectStore(project)
    const run = await store.loadRun(runId)
    if (!run) throw new Error('Task not found')
    const restored: string[] = []
    for (const [rel, original] of Object.entries(run.backups ?? {})) {
      if (original === null) await fsp.rm(await resolveInside(project, rel), { force: true })
      else await writeText(project, rel, original)
      restored.push(rel)
    }
    run.backups = {}
    for (const t of run.transcript) if (t.kind === 'summary' && t.summary) t.summary.revertable = false
    run.transcript.push({ id: shortId(), at: nowIso(), kind: 'status', text: `Reverted ${restored.length} file(s): ${restored.join(', ')}` })
    await store.saveRun(run)
    return restored
  }

  // ---------------------------------------------------------------- internals
  private addItem(ctl: RunCtl, item: Omit<TranscriptItem, 'id' | 'at'>): TranscriptItem {
    const full: TranscriptItem = { id: shortId(), at: nowIso(), ...item }
    ctl.run.transcript.push(full)
    this.deps.emit({ runId: ctl.run.id, project: ctl.run.project, type: 'transcript', item: full })
    return full
  }
  private log(ctl: RunCtl, level: 'info' | 'error', text: string): void {
    ctl.run.log!.push({ at: nowIso(), level, text: redact(text).slice(0, 4000) })
    if (ctl.run.log!.length > 2000) ctl.run.log!.splice(0, ctl.run.log!.length - 2000)
  }
  private emitRun(ctl: RunCtl): void {
    this.deps.emit({ runId: ctl.run.id, project: ctl.run.project, type: 'run', run: summary(ctl.run), status: ctl.run.status })
  }
  private emitAgent(ctl: RunCtl, a: AgentInfo): void {
    this.deps.emit({ runId: ctl.run.id, project: ctl.run.project, type: 'agent', agent: { ...a } })
  }
  private async setStatus(ctl: RunCtl, status: RunState['status']): Promise<void> {
    ctl.run.status = status
    await ctl.store.saveRun(ctl.run)
    this.deps.emit({ runId: ctl.run.id, project: ctl.run.project, type: 'status', status })
    this.emitRun(ctl)
  }
  private async finish(ctl: RunCtl, status: RunState['status']): Promise<void> {
    const t = ctl.turn
    const s: TurnSummary = { changedFiles: [...t.changed], commands: t.commands, toolCount: t.toolCount, durationMs: Date.now() - t.start, memoriesSaved: t.memories, revertable: Object.keys(ctl.run.backups).length > 0 }
    if (s.toolCount || s.changedFiles.length || s.memoriesSaved) this.addItem(ctl, { kind: 'summary', text: '', summary: s })
    this.log(ctl, status === 'failed' ? 'error' : 'info', `Turn finished: ${status}, ${s.toolCount} tool calls, ${s.changedFiles.length} files changed, ${Math.round(s.durationMs / 1000)}s`)
    if ((await this.deps.getSettings()).maintainProgress)
      await progressFinish(ctl.run.project, { run: ctl.run, prompt: ctl.prompt, status, answer: ctl.answer, summary: s, error: ctl.run.lastError }).catch((e) => this.log(ctl, 'error', `PROGRESS.md: ${(e as Error).message}`))
    await this.setStatus(ctl, status)
    this.active.delete(this.key(ctl.run.project))
  }

  private async runTurn(ctl: RunCtl): Promise<void> {
    const run = ctl.run
    const lead: AgentCtx = {
      info: { id: 'lead', runId: run.id, project: run.project, role: 'lead', name: 'Dahl', task: run.objective, status: 'thinking', step: 'Starting', toolCount: 0, startedAt: nowIso(), files: [] },
      messages: run.messages,
      isLead: true
    }
    const settings = await this.deps.getSettings()
    if (settings.maintainProgress) await progressStart(run.project, run, ctl.prompt).catch((e) => this.log(ctl, 'error', `PROGRESS.md: ${(e as Error).message}`))
    try {
      if (this.deps.mcp && run.mode === 'build') ctl.mcpTools = await this.deps.mcp.toolsFor(run.project).catch((e) => (this.log(ctl, 'error', `MCP unavailable: ${(e as Error).message}`), []))
      ctl.answer = await this.agentLoop(ctl, lead)
      await this.autoMemory(ctl).catch((e) => this.log(ctl, 'error', `auto-memory failed: ${(e as Error).message}`))
      await this.finish(ctl, 'completed')
    } catch (e) {
      if (e instanceof PauseSignal) {
        this.addItem(ctl, { kind: 'status', text: e.message })
        return this.finish(ctl, 'paused')
      }
      const err = e as Error
      if ((err instanceof DahlError && err.kind === 'cancelled') || ctl.abort.signal.aborted) {
        this.addItem(ctl, { kind: 'status', text: 'Task cancelled.' })
        return this.finish(ctl, 'cancelled')
      }
      const msg = redact(err.message ?? String(err), await this.deps.secrets())
      run.lastError = msg
      this.log(ctl, 'error', `${err.name}: ${msg}${err instanceof DahlError ? ` (kind=${err.kind}, status=${err.status ?? 'n/a'})` : `\n${err.stack ?? ''}`}`)
      this.addItem(ctl, { kind: 'error', text: msg })
      await this.finish(ctl, 'failed')
    }
  }

  private allowedTools(ctl: RunCtl, a: AgentCtx): string[] {
    const base: string[] = toolsFor(a.info.role, ctl.run.mode, ctl.web)
    if (a.isLead) base.push(...ctl.mcpTools.map((t) => t.fnName))
    return base
  }

  private toolDefs(ctl: RunCtl, a: AgentCtx): unknown[] {
    const defs: unknown[] = toolsFor(a.info.role, ctl.run.mode, ctl.web).map((n) => TOOL_DEFS[n])
    if (a.isLead)
      for (const t of ctl.mcpTools)
        defs.push({ type: 'function', function: { name: t.fnName, description: `[MCP ${t.serverName}] ${t.tool.description ?? t.tool.name}`.slice(0, 1000), parameters: t.tool.inputSchema ?? { type: 'object', properties: {} } } })
    return defs
  }

  private async system(ctl: RunCtl, a: AgentCtx): Promise<string> {
    const run = ctl.run
    const last = [...run.messages].reverse().find((m) => m.role === 'user')
    const lastText = typeof last?.content === 'string' ? last.content : (last?.content ?? []).map((p) => (p.type === 'text' ? p.text : '')).join(' ')
    const memory = (await ctl.store.relevantMemory(`${run.objective} ${lastText} ${a.isLead ? '' : a.info.task}`)).map((m) => m.text)
    const reasoning = this.deps.reasoning ? await this.deps.reasoning(run.project) : { name: 'Default', prompt: 'Reason carefully and verify your work.' }
    return systemPrompt({
      role: a.info.role, mode: run.mode, projectName: path.basename(run.project), outline: await projectOutline(run.project), memory,
      plan: run.plan.map((s) => `[${s.status}] ${s.title}`).join('\n'), reasoning, thinking: THINKING_GUIDANCE[run.thinking ?? 'off'],
      task: a.isLead ? undefined : a.info.task, files: a.info.files, mcp: a.isLead ? ctl.mcpTools.map((t) => t.fnName) : [],
      progress: (await this.deps.getSettings()).maintainProgress ? await readProgress(run.project) : ''
    })
  }

  /** The agent loop shared by the lead agent and sub-agents. Returns the agent's final text. */
  private async agentLoop(ctl: RunCtl, a: AgentCtx): Promise<string> {
    const run = ctl.run
    const settings = await this.deps.getSettings()
    void settings
    const maxIter = this.deps.maxIterations ?? (run.thinking === 'high' ? 60 : 40)
    const vision = this.deps.modelVision ? await this.deps.modelVision(run.model) : false
    let iter = 0
    let nudges = 0
    let verified = false
    let lastText = ''
    while (true) {
      if (ctl.abort.signal.aborted) throw new DahlError('cancelled', 'cancelled')
      if (a.isLead && ctl.pauseRequested) throw new PauseSignal('Paused. State is checkpointed; send "Continue" to resume.')
      if (iter >= maxIter) {
        if (a.isLead) throw new PauseSignal(`Step limit (${maxIter}) reached. State is checkpointed; send "Continue" to keep going.`)
        return `${lastText}\n[Stopped after ${maxIter} steps]`
      }
      iter++
      if (a.isLead) run.iterations++
      a.info.status = 'thinking'
      a.info.step = 'Thinking'
      if (!a.isLead) this.emitAgent(ctl, a.info)
      const messages: ChatMessage[] = [{ role: 'system', content: await this.system(ctl, a) }, ...compact(a.messages)]
      let streamed = ''
      const res = await this.deps.backend.chat({ model: run.model, messages, tools: this.toolDefs(ctl, a), thinking: run.thinking, vision }, ctl.abort.signal, a.isLead
        ? {
            onDelta: (t) => ((streamed += t), this.deps.emit({ runId: run.id, project: run.project, type: 'delta', delta: t })),
            onReasoning: (t) => this.deps.emit({ runId: run.id, project: run.project, type: 'reasoning_delta', delta: t })
          }
        : {})
      const calls = res.toolCalls ?? []
      let content = cleanModelText(res.content || streamed)
      let reasoning = trimRepetition(res.reasoning ?? '')
      // Some models stream their final answer inside reasoning_content and leave content empty: promote it.
      if (!content && !calls.length && reasoning) {
        const parts = reasoning.split(/\n{3,}/)
        content = cleanModelText(parts.length > 1 ? parts.pop()! : reasoning)
        reasoning = parts.length ? parts.join('\n\n') : ''
        this.log(ctl, 'info', `${a.info.name}: final answer arrived in reasoning_content; shown as the reply`)
      }
      lastText = content
      if (a.isLead && reasoning) this.addItem(ctl, { kind: 'reasoning', text: reasoning })
      a.messages.push({ role: 'assistant', content: content || null, ...(calls.length ? { tool_calls: calls } : {}), ...(res.providerBlocks?.length ? { providerBlocks: res.providerBlocks } : {}) })
      if (a.isLead && content.trim()) this.addItem(ctl, { kind: 'assistant', text: content })
      if (res.finishReason === 'length') this.log(ctl, 'error', `${a.info.name}: model output hit the length limit (finish_reason=length)`)
      if (!calls.length) {
        // "Lazy" models announce work ("Here it comes", "Let me...") and stop without calling a tool. Nudge them (max 2x).
        if (run.mode === 'build' && nudges < 2 && announcesWork(content)) {
          nudges++
          this.log(ctl, 'info', `${a.info.name}: reply announced work without a tool call; nudged to act (${nudges}/2)`)
          a.messages.push({ role: 'user', content: 'You said what you will do but did not call any tool, so nothing happened. Do it now by calling the tools (split large files into write_file + append_file). Do not just describe it.' })
          continue
        }
        // Weaker models often stop right after editing. Ask once for evidence before accepting "done".
        if (a.isLead && run.mode === 'build' && !verified && ctl.turn.changed.size > 0 && ctl.turn.commands.length === 0) {
          verified = true
          this.log(ctl, 'info', 'Files changed without any verification; asked the model to verify once')
          a.messages.push({ role: 'user', content: 'Before finishing: verify your changes with evidence. Run the relevant build, test or lint command if the project has one; otherwise read back the changed files and check them for syntax errors and missing pieces. Fix anything wrong, then give a short summary.' })
          continue
        }
        if (res.finishReason === 'length' && iter < maxIter) {
          a.messages.push({ role: 'user', content: 'Your previous reply was cut off by the output length limit. Continue exactly where you stopped; split large files into several write_file/append_file calls.' })
          continue
        }
        return content
      }
      const delegations = calls.filter((c) => c.function.name === 'delegate_agents')
      const pendingImages: ContentPart[] = []
      for (const tc of calls) {
        if (ctl.abort.signal.aborted) {
          a.messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Not executed: run cancelled.' })
          continue
        }
        a.info.status = 'tool'
        a.info.step = summariseTool(tc.function.name, tc.function.arguments)
        a.info.toolCount++
        ctl.turn.toolCount++
        if (!a.isLead) this.emitAgent(ctl, a.info)
        const result: ToolResult = delegations.includes(tc) ? await this.delegate(ctl, tc.function.arguments) : await execTool(this.execCtx(ctl, a), tc.function.name, tc.function.arguments, this.allowedTools(ctl, a))
        const safe = redact(result.text, await this.deps.secrets())
        if (!result.ok) this.log(ctl, 'error', `${a.info.name} ${tc.function.name} failed: ${safe.slice(0, 800)}`)
        // keep invalid arguments out of history so later requests are not rejected
        if (!isJson(tc.function.arguments)) tc.function.arguments = JSON.stringify({ _invalid_arguments: true })
        a.messages.push({ role: 'tool', tool_call_id: tc.id, content: safe })
        // images are added after ALL tool results of this step (APIs require tool results directly after the call)
        if (result.images?.length) pendingImages.push({ type: 'text', text: `Images returned by ${tc.function.name}:` }, ...result.images.map((im): ContentPart => ({ type: 'image', mediaType: im.mediaType, data: im.data, name: im.name })))
        this.addItem(ctl, { kind: 'tool', text: (a.isLead ? '' : `${a.info.name}: `) + summariseTool(tc.function.name, tc.function.arguments), tool: { name: tc.function.name, args: tc.function.arguments.slice(0, 2000), result: safe.slice(0, 6000), ok: result.ok, agent: a.isLead ? undefined : a.info.name } })
      }
      if (pendingImages.length) a.messages.push({ role: 'user', content: pendingImages })
      if (a.isLead) await ctl.store.saveRun(run)
    }
  }

  private execCtx(ctl: RunCtl, a: AgentCtx): ExecCtx {
    return {
      run: ctl.run, store: ctl.store, deps: this.deps, signal: ctl.abort.signal, agentId: a.info.id, agentName: a.info.name, ownedFiles: a.info.files,
      leases: ctl.leases, images: ctl.images, mcpTools: ctl.mcpTools, turn: ctl.turn,
      approve: (x) => this.requestApproval(ctl, a, x),
      emitPlan: (plan) => {
        this.deps.emit({ runId: ctl.run.id, project: ctl.run.project, type: 'plan', plan })
        void this.deps.getSettings().then((s) => (s.maintainProgress ? progressPlan(ctl.run.project, plan) : undefined)).catch(() => {})
      },
      onChanged: () => this.emitRun(ctl),
      status: (text) => this.log(ctl, 'info', text)
    }
  }

  /** Run sub-agents in parallel. Write-capable agents get file leases so they cannot overwrite each other. */
  private async delegate(ctl: RunCtl, raw: string): Promise<ToolResult> {
    let specs: { role: AgentRole; task: string; files?: string[] }[]
    try {
      specs = (JSON.parse(raw).agents ?? []).slice(0, 6)
    } catch {
      return { ok: false, text: 'Invalid delegate_agents arguments.' }
    }
    if (!specs.length) return { ok: false, text: 'No agents specified.' }
    const agents: AgentCtx[] = specs.map((s, i) => {
      const role = (ROLE_INFO[s.role] ? s.role : 'researcher') as AgentRole
      const files = (s.files ?? []).map(String)
      const info: AgentInfo = { id: `${role}-${shortId().slice(0, 4)}`, runId: ctl.run.id, project: ctl.run.project, role, name: `${ROLE_INFO[role].name}${specs.filter((x) => x.role === role).length > 1 ? ` ${i + 1}` : ''}`, task: String(s.task), status: 'thinking', step: 'Starting', toolCount: 0, startedAt: nowIso(), files }
      if (WRITE_ROLES.includes(role)) for (const f of files) ctl.leases.set(f.replace(/\\/g, '/').toLowerCase(), info.id)
      return { info, messages: [{ role: 'user', content: `Task from the lead agent:\n${s.task}` }], isLead: false }
    })
    ctl.run.agents!.push(...agents.map((x) => x.info))
    this.addItem(ctl, { kind: 'agents', text: `Delegated to ${agents.map((x) => x.info.name).join(', ')}`, agentIds: agents.map((x) => x.info.id) })
    agents.forEach((x) => this.emitAgent(ctl, x.info))
    const reports = await Promise.all(
      agents.map(async (x) => {
        try {
          const report = await this.agentLoop(ctl, x)
          Object.assign(x.info, { status: 'done', step: 'Finished', report: report.slice(0, 8000), endedAt: nowIso() })
          return `## ${x.info.name}\n${report}`
        } catch (e) {
          if (ctl.abort.signal.aborted) Object.assign(x.info, { status: 'cancelled', endedAt: nowIso() })
          else Object.assign(x.info, { status: 'failed', step: (e as Error).message.slice(0, 200), endedAt: nowIso() })
          this.log(ctl, 'error', `Agent ${x.info.name} failed: ${(e as Error).message}`)
          return `## ${x.info.name}\nFAILED: ${(e as Error).message}`
        } finally {
          this.emitAgent(ctl, x.info)
          for (const [f, owner] of ctl.leases) if (owner === x.info.id) ctl.leases.delete(f)
        }
      })
    )
    if (ctl.abort.signal.aborted) throw new DahlError('cancelled', 'cancelled')
    return { ok: true, text: `Sub-agent reports:\n\n${reports.join('\n\n')}` }
  }

  private async requestApproval(ctl: RunCtl, a: AgentCtx, x: Omit<PendingApproval, 'id' | 'runId' | 'project'>): Promise<{ approved: boolean; feedback?: string }> {
    if (ctl.abort.signal.aborted) return { approved: false, feedback: 'Run cancelled' }
    const approval: PendingApproval = { id: shortId(), runId: ctl.run.id, project: ctl.run.project, ...x }
    const p = new Promise<{ approved: boolean; feedback?: string }>((resolve) => ctl.approvals.set(approval.id, { approval, resolve }))
    this.addItem(ctl, { kind: 'approval', text: x.kind === 'write' ? `Approve change to ${x.path}?` : x.kind === 'command' ? `Approve command: ${x.command}` : `Approve ${x.tool}?`, approvalId: approval.id })
    this.deps.emit({ runId: ctl.run.id, project: ctl.run.project, type: 'approval', approval })
    a.info.status = 'waiting_approval'
    if (!a.isLead) this.emitAgent(ctl, a.info)
    await this.setStatus(ctl, 'waiting_approval')
    const d = await p
    if (!ctl.abort.signal.aborted && ctl.approvals.size === 0) await this.setStatus(ctl, 'running')
    this.log(ctl, 'info', `${d.approved ? 'Approved' : 'Rejected'}: ${x.kind} ${x.path ?? x.command ?? x.tool ?? ''}`)
    return d
  }

  /** Learn from the turn: extract up to 3 durable project facts with one small model call (when enabled). */
  private async autoMemory(ctl: RunCtl): Promise<void> {
    const settings = await this.deps.getSettings()
    if (!settings.autoMemory || ctl.abort.signal.aborted) return
    if (ctl.turn.memories > 0 || (ctl.turn.toolCount < 2 && !ctl.turn.changed.size)) return
    const recent = ctl.run.messages.slice(-14).map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => (p.type === 'text' ? p.text : '[image]')).join(' ')}`.slice(0, 1500)).join('\n')
    const existing = (await ctl.store.listMemory()).map((m) => m.text)
    const res = await this.deps.backend.chat({
      model: ctl.run.model,
      messages: [
        { role: 'system', content: 'Extract durable facts about this software project worth remembering in future sessions: stack, structure, how to run/test, conventions, decisions, known issues, user preferences. Return ONLY a JSON array of up to 3 objects {"text": string, "tags": string[]}. Return [] if nothing new. Never include secrets.' },
        { role: 'user', content: `Already known:\n${existing.slice(-30).join('\n') || '(nothing)'}\n\nRecent conversation:\n${recent}` }
      ]
    }, ctl.abort.signal)
    const m = /\[[\s\S]*\]/.exec(res.content)
    if (!m) return
    let facts: { text: string; tags?: string[] }[] = []
    try {
      facts = JSON.parse(m[0])
    } catch {
      return
    }
    const known = new Set(existing.map((t) => t.toLowerCase().trim()))
    for (const f of facts.slice(0, 3)) {
      const text = redact(String(f.text ?? '').trim(), await this.deps.secrets())
      if (text.length < 8 || known.has(text.toLowerCase())) continue
      await ctl.store.addMemory(text, Array.isArray(f.tags) ? f.tags.map(String).slice(0, 4) : [], `auto:${ctl.run.id}`)
      ctl.turn.memories++
    }
    if (ctl.turn.memories) this.log(ctl, 'info', `Saved ${ctl.turn.memories} memory entries automatically`)
  }
}

function isJson(s: string): boolean {
  try {
    JSON.parse(s || '{}')
    return true
  } catch {
    return false
  }
}

/** True when a reply ends by announcing an action ("Here it comes.", "Let me create...", "Next I'll...:") instead of finishing. */
export function announcesWork(text: string): boolean {
  const tail = text.trim().slice(-220)
  if (!tail) return false
  if (/:\s*$/.test(tail)) return true
  return /(here it comes|let me (now )?(create|write|build|implement|fix|update|add|start|do|make|rebuild)|i('| wi)ll (now )?(create|write|build|implement|fix|update|add|start|rebuild|make)|i'm (now )?(going to|creating|writing|building|doing|rebuilding)|starting now|on it\b|proceeding)[^.?!]*[.!]?\s*$/i.test(tail)
}

/** Collapse degenerate output where a phrase repeats many times in a row (seen with some open models). */
export function trimRepetition(s: string): string {
  return s.replace(/(.{3,120}?)(?:\s*\|?\s*\1){3,}/gsu, '$1')
}

/** Remove leaked special tokens (e.g. DeepSeek DSML tool markers), emoji and degenerate repetition from model text. */
export function cleanModelText(s: string): string {
  return trimRepetition(s)
    .replace(/<\/?\uFF5C[^>]*?\uFF5C[^>]*>/g, '')
    .replace(/<\uFF5C[^\uFF5C]*\uFF5C>/g, '')
    .replace(/(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}))*/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}
