import type { AgentInfo, PendingApproval, RunStatus, TranscriptItem } from '@shared/types'
import { routeTarget, type ChatFields } from './chatState'

// One status vocabulary for chat tabs, project tabs, the status bar and the Agents view. Shape first, colour second
// (StatusIcon.tsx). When several chats are combined, the highest priority wins, as in VS Code's agent list:
// input needed, then in progress, then error, then unread, paused, done, idle.

export type StatusKind = 'needs' | 'running' | 'failed' | 'unread' | 'paused' | 'done' | 'idle'
export const PRIORITY: StatusKind[] = ['needs', 'running', 'failed', 'unread', 'paused', 'done', 'idle']

export const STATUS_LABEL: Record<StatusKind, string> = {
  needs: 'Needs your input', running: 'Working', failed: 'Failed', unread: 'Done, not seen yet', paused: 'Paused', done: 'Done', idle: 'Idle'
}

export function statusKind(s: RunStatus | null | undefined, unread = false): StatusKind {
  switch (s) {
    case 'waiting_approval': return 'needs'
    case 'running': return 'running'
    case 'failed': return 'failed'
    case 'paused': case 'interrupted': return 'paused'
    case 'completed': return unread ? 'unread' : 'done'
    default: return 'idle'
  }
}

/** Words for one run status (more specific than the kind: "Interrupted", "Cancelled"). */
export function statusText(s: RunStatus | null | undefined, unread = false): string {
  if (s === 'interrupted') return 'Interrupted'
  if (s === 'cancelled') return 'Cancelled'
  return STATUS_LABEL[statusKind(s, unread)]
}

export function topKind(kinds: StatusKind[]): StatusKind {
  return PRIORITY.find((k) => kinds.includes(k)) ?? 'idle'
}

/** A chat tab's kind. The active chat keeps its live status on the project itself. */
export function chatKind(p: ChatFields, key: string): StatusKind {
  const t = p.chats.find((c) => c.key === key)
  return statusKind(key === p.chat ? p.status : t?.status, t?.unread)
}

/** A whole project: every chat counts. */
export function projectKind(p: ChatFields | undefined): StatusKind {
  if (!p) return 'idle'
  return topKind(p.chats.map((t) => chatKind(p, t.key)))
}

/** Chats (across projects) that are waiting for the user. */
export function countNeeds(projects: Record<string, ChatFields>): number {
  let n = 0
  for (const p of Object.values(projects)) for (const t of p.chats) if (chatKind(p, t.key) === 'needs') n++
  return n
}

/** Mark the chat that owns runId as finished but not seen. Returns null when the user is looking at it. */
export function markUnread(c: ChatFields, runId: string, onScreen: boolean): Partial<ChatFields> | null {
  const target = routeTarget(c, runId)
  const key = target === 'view' ? c.chat : target
  if (target === 'view' && onScreen) return null
  return { chats: c.chats.map((t) => (t.key === key ? { ...t, unread: true } : t)) }
}

export function agentKind(a: AgentInfo): StatusKind {
  if (a.status === 'waiting_approval') return 'needs'
  if (a.status === 'thinking' || a.status === 'tool') return 'running'
  if (a.status === 'failed') return 'failed'
  if (a.status === 'cancelled') return 'paused'
  return 'done'
}

/** Is the question card (not an approval) what this run waits for? */
export function waitsForAnswer(approvals: PendingApproval[], runId: string | null, transcript: TranscriptItem[]): boolean {
  const mine = approvals.filter((a) => a.runId === runId)
  if (mine.length) return mine.some((a) => a.kind === 'question')
  const last = [...transcript].reverse().find((i) => i.kind === 'approval')
  return !!last?.text.startsWith('Question:')
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const VERBS: Record<string, [string, string]> = {
  read_file: ['Reading', 'Read'], list_dir: ['Listing', 'Listed'], list_files: ['Listing', 'Listed'], search_files: ['Searching', 'Searched'], search: ['Searching', 'Searched'],
  write_file: ['Writing', 'Wrote'], edit_file: ['Editing', 'Edited'], append_file: ['Adding to', 'Added to'], run_command: ['Running', 'Ran'],
  web_search: ['Searching the web for', 'Searched the web for'], web_fetch: ['Fetching', 'Fetched'], delegate_agents: ['Delegating', 'Delegated'], analyze_image: ['Looking at', 'Looked at']
}

/** "Edited src/app.ts" from a finished tool step (present tense with now = true). */
export function describeTool(t: NonNullable<TranscriptItem['tool']>, now = false): string {
  let target = ''
  try {
    const a = JSON.parse(t.args) as Record<string, unknown>
    target = String(a.path ?? a.command ?? a.query ?? a.url ?? '')
  } catch {
    /* arguments are cut at 2000 characters; fall back to the tool name */
  }
  const v = VERBS[t.name]
  const who = t.agent ? `${t.agent}: ` : ''
  if (v) return `${who}${v[now ? 0 : 1]}${target ? ` ${target}` : ''}`
  return `${who}${now ? 'Using' : 'Used'} ${t.name.replace(/^mcp__/, '').replace(/__/g, ' / ').replace(/_/g, ' ')}`
}

interface ActionInput { status: RunStatus | null; live: string; liveReasoning: string; transcript: TranscriptItem[]; approvals: PendingApproval[]; runId: string | null }

/** The one-line "what is Dahl doing right now" for the progress strip, plus the last finished step. */
export function currentAction(p: ActionInput): { text: string; last: string | null } {
  const lastUser = p.transcript.map((i) => i.kind).lastIndexOf('user')
  const turn = p.transcript.slice(lastUser + 1)
  const lastTool = [...turn].reverse().find((i) => i.kind === 'tool' && i.tool)
  const last = lastTool?.tool ? describeTool(lastTool.tool) : null
  if (p.status === 'waiting_approval') {
    const a = p.approvals.find((x) => x.runId === p.runId)
    if (a?.kind === 'question' || (!a && waitsForAnswer(p.approvals, p.runId, turn))) return { text: 'Waiting for your answer', last }
    if (a?.kind === 'write') return { text: `Waiting for you to approve a change to ${a.path}`, last }
    if (a?.kind === 'command') return { text: `Waiting for you to approve: ${a.command}`, last }
    return { text: 'Waiting for your approval', last }
  }
  if (p.live) return { text: 'Writing the reply', last }
  if (p.liveReasoning) return { text: 'Thinking', last }
  const tail = turn[turn.length - 1]
  if (tail?.kind === 'approval' && tail.text.startsWith('Approve command: ')) return { text: `Running ${tail.text.slice(17)}`, last }
  if (tail?.kind === 'approval' && /^Approve change to (.+)\?$/.test(tail.text)) return { text: `Applying the change to ${tail.text.slice(18, -1)}`, last }
  if (tail?.kind === 'agents') return { text: tail.text.replace(/^Delegated to/, 'Sub-agents working:'), last }
  return { text: last ? 'Deciding the next step' : 'Thinking', last }
}

/** When the current turn started: the live timer, or the last user message of a restored run. */
export function turnStart(turnStartedAt: number | null, transcript: TranscriptItem[]): number | null {
  if (turnStartedAt) return turnStartedAt
  const u = [...transcript].reverse().find((i) => i.kind === 'user')
  const t = u ? Date.parse(u.at) : NaN
  return Number.isFinite(t) ? t : null
}
