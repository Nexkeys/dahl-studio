import path from 'node:path'
import type { AgentMode, PendingApproval, RunSummary, StartRunRequest } from '@shared/types'
import { stripDashes } from '@shared/dashes'
import type { ExecCtx, ToolResult } from '../agent/toolExec'
import { ChiefStore, GOALS_TEMPLATE } from './store'
import { formatBriefing, gatherBriefing } from './briefing'

// Chief of Staff tools for the lead agent (any mode): a briefing across all open projects, follow-ups and goals kept
// in the app data folder, and starting a task in another project (always asks the user first).

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties, required } }
})
const S = { type: 'string' }

export const CHIEF_DEFS = {
  chief_briefing: fn('chief_briefing', 'Chief of Staff: gather everything Dahl can see across ALL open projects in one call: goals (goals.md), what needs the user (pending approvals, failed, paused or interrupted tasks, overdue and due follow-ups), agent work since the last briefing, running tasks, each project\'s git state (uncommitted, unpushed) and PROGRESS.md next steps. Read-only. Condense the result; never paste it raw.', {
    mark_seen: { type: 'boolean', description: 'Record this as the last briefing, so the next one reports agent work since now (default true; false for a quick peek)' }
  }, []),
  chief_followups: fn('chief_followups', 'Chief of Staff follow-ups (kept by Dahl Studio, not in any project): add one with a due date, list open ones, or complete one by id.', {
    action: { type: 'string', enum: ['add', 'list', 'complete'] },
    text: { type: 'string', description: 'add: what to follow up on, as an action' },
    due: { type: 'string', description: 'add: YYYY-MM-DD, today, tomorrow, "in 3 days" or "next week"' },
    project: { type: 'string', description: 'add/list: open project name, or "current"; omit for general follow-ups' },
    id: { type: 'string', description: 'complete: the follow-up id from list' },
    include_done: { type: 'boolean', description: 'list: also show completed ones' }
  }, ['action']),
  chief_goals: fn('chief_goals', 'Chief of Staff goals file (goals.md in the Dahl Studio data folder), the source of truth for priorities. read it, or update it by sending the WHOLE new Markdown (read first, change only what the user agreed to).', {
    action: { type: 'string', enum: ['read', 'update'] }, content: { type: 'string', description: 'update: the complete new goals.md' }
  }, ['action']),
  chief_delegate: fn('chief_delegate', 'Start a task in ANOTHER open project (for example after triage). Always asks the user first and shows them the task. Use it only after the user agreed to delegate; for the current project, just do the work.', {
    project: { type: 'string', description: 'Open project name or folder' }, task: S,
    mode: { type: 'string', enum: ['plan', 'review', 'build'], description: 'default plan' }
  }, ['project', 'task'])
} as const

export type ChiefToolName = keyof typeof CHIEF_DEFS
export const CHIEF_TOOLS = Object.keys(CHIEF_DEFS) as ChiefToolName[]

export interface ChiefHost {
  appDir: string
  approvals(): PendingApproval[]
  activeRuns(): { project: string; runId: string }[]
  startTask?(req: StartRunRequest): Promise<RunSummary>
}
let host: ChiefHost | null = null
/** Wired by services.ts (the runner owns approvals and active runs). */
export function configureChief(h: ChiefHost): void {
  host = h
}

/** An open project by folder name or path ("current" is the task's own project). */
export function resolveProject(want: string, open: string[], current: string): string | null {
  const w = want.trim().toLowerCase()
  if (!w) return null
  if (w === 'current' || w === 'this') return current
  const norm = (p: string): string => path.resolve(p).toLowerCase()
  return open.find((p) => norm(p) === norm(want) || path.basename(p).toLowerCase() === w) ?? null
}

export async function execChief(c: ExecCtx, name: string, a: Record<string, any>): Promise<ToolResult> {
  if (!host) return { ok: false, text: 'Chief of Staff tools are not available in this session.' }
  const store = new ChiefStore(host.appDir)
  const open = (await c.deps.getSettings()).openProjects
  const project = (v: unknown): string | null | false => (v === undefined || v === null || v === '' ? null : resolveProject(String(v), open, c.run.project) ?? false)
  const openList = open.map((p) => path.basename(p)).join(', ') || 'none'
  if (name === 'chief_briefing') {
    const data = await gatherBriefing({ projects: open, store, approvals: host.approvals(), activeRuns: host.activeRuns() })
    if (a.mark_seen !== false) await store.markBriefed(data.at.toISOString())
    return { ok: true, text: formatBriefing(data) }
  }
  if (name === 'chief_followups') {
    const p = project(a.project)
    if (p === false) return { ok: false, text: `No open project called "${a.project}". Open projects: ${openList}.` }
    if (a.action === 'add') {
      const f = await store.addFollowup(stripDashes(String(a.text ?? '')), { due: a.due ? String(a.due) : null, project: p })
      return { ok: true, text: `Added follow-up ${f.id}${f.due ? ` due ${f.due}` : ''}: ${f.text}` }
    }
    if (a.action === 'complete') {
      const f = await store.completeFollowup(String(a.id ?? ''))
      return { ok: true, text: `Completed: ${f.text}` }
    }
    const list = await store.listFollowups({ project: p ?? undefined, withDone: !!a.include_done })
    return { ok: true, text: list.length ? list.map((f) => `- [${f.id}] ${f.doneAt ? '(done) ' : ''}${f.due ?? 'no date'}: ${f.text}${f.project ? ` (${path.basename(f.project)})` : ''}`).join('\n') : 'No open follow-ups.' }
  }
  if (name === 'chief_goals') {
    if (a.action === 'update') {
      await store.setGoals(stripDashes(String(a.content ?? '')))
      return { ok: true, text: 'goals.md updated.' }
    }
    const g = await store.goals()
    return { ok: true, text: g ?? `No goals.md yet. Ask the user for their goals and this week's top 3 priorities, then save them with chief_goals update. Suggested layout:\n${GOALS_TEMPLATE}` }
  }
  if (name === 'chief_delegate') {
    const p = project(a.project)
    if (!p) return { ok: false, text: `No open project called "${a.project}". Open projects: ${openList}.` }
    if (path.resolve(p).toLowerCase() === path.resolve(c.run.project).toLowerCase()) return { ok: false, text: 'That is the current project: do the work here instead of delegating.' }
    if (!host.startTask) return { ok: false, text: 'Starting tasks in other projects is not available here.' }
    const mode: AgentMode = ['plan', 'review', 'build'].includes(a.mode) ? a.mode : 'plan'
    const task = stripDashes(String(a.task ?? '')).trim()
    if (!task) return { ok: false, text: 'Say what the task should do.' }
    const d = await c.approve({ kind: 'github', agent: c.agentName, tool: `Start a ${mode} task in ${path.basename(p)}`, args: task })
    if (!d.approved) return { ok: false, text: `The user did not start the task.${d.feedback ? ` Feedback: ${d.feedback}` : ''}` }
    try {
      const r = await host.startTask({ project: p, prompt: task, mode, model: c.run.model, thinking: c.run.thinking })
      return { ok: true, text: `Started task ${r.id} in ${path.basename(p)} (${mode} mode). It runs in that project; the user can follow it in that project's chat or under Tasks.` }
    } catch (e) {
      return { ok: false, text: `Could not start the task: ${(e as Error).message}` }
    }
  }
  return { ok: false, text: `Unknown tool ${name}` }
}
