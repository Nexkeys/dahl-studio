import type { PlanStep, RunStatus, TranscriptItem } from '@shared/types'

// Chat tabs. Each tab is one conversation (one run). The active chat keeps its fields on ProjectUI itself, so every
// existing component keeps reading p.transcript, p.status and so on. Other chats keep a snapshot, and agent events
// are routed to whichever chat owns the run, so a chat keeps streaming while you look at another one.
// No store imports here: store.ts uses these helpers.

/** The fields that belong to one conversation. */
export interface ChatSnap {
  runId: string | null
  status: RunStatus | null
  transcript: TranscriptItem[]
  live: string
  liveReasoning: string
  plan: PlanStep[]
  turnStartedAt: number | null
}

export interface ChatTab {
  key: string
  title: string
  runId: string | null
  status: RunStatus | null
  /** null for the active chat (its state lives on ProjectUI) and for restored chats that are not loaded yet */
  snap: ChatSnap | null
  /** finished while the user was looking elsewhere; cleared when the chat is shown */
  unread?: boolean
}

export interface ChatFields extends ChatSnap {
  chats: ChatTab[]
  /** key of the active chat */
  chat: string
  /** chat that just asked to start a run; the first event of a run nobody owns yet goes to it */
  startingChat: string | null
}

export const NEW_CHAT = 'New chat'
export const MAX_CHATS = 10

let seq = 0
export const chatKey = (): string => `c${Date.now().toString(36)}${(seq++).toString(36)}`
export const blankSnap = (): ChatSnap => ({ runId: null, status: null, transcript: [], live: '', liveReasoning: '', plan: [], turnStartedAt: null })
export const newTab = (): ChatTab => ({ key: chatKey(), title: NEW_CHAT, runId: null, status: null, snap: null })
export const isBusy = (s: RunStatus | null | undefined): boolean => s === 'running' || s === 'waiting_approval'

export function pickSnap(c: ChatSnap): ChatSnap {
  return { runId: c.runId, status: c.status, transcript: c.transcript, live: c.live, liveReasoning: c.liveReasoning, plan: c.plan, turnStartedAt: c.turnStartedAt }
}

export function titleFrom(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 48) || NEW_CHAT
}

/** Which chat an event for runId belongs to: 'view' (the active chat) or the key of a background chat. */
export function routeTarget(c: ChatFields, runId: string): string {
  if (c.runId === runId) return 'view'
  const bg = c.chats.find((t) => t.key !== c.chat && t.runId === runId)
  if (bg) return bg.key
  if (c.startingChat && c.startingChat !== c.chat && c.chats.some((t) => t.key === c.startingChat)) return c.startingChat
  return 'view'
}

/** Keep the active tab's runId and status (shown on the tab) in step with the view. */
export function syncTab(chats: ChatTab[], key: string, s: ChatSnap): ChatTab[] {
  return chats.map((t) => (t.key === key && (t.runId !== s.runId || t.status !== s.status) ? { ...t, runId: s.runId, status: s.status } : t))
}

/** Apply a conversation update to the chat that owns runId. Returns the ProjectUI patch. */
export function patchChat(c: ChatFields, runId: string, fn: (s: ChatSnap) => Partial<ChatSnap>): Partial<ChatFields> {
  const target = routeTarget(c, runId)
  if (target === 'view') {
    const cur = pickSnap(c)
    const next = { ...cur, ...fn(cur) }
    return { ...next, chats: syncTab(c.chats, c.chat, next), startingChat: c.startingChat === c.chat ? null : c.startingChat }
  }
  const chats = c.chats.map((t) => {
    if (t.key !== target) return t
    const base = t.snap ?? { ...blankSnap(), runId: t.runId, status: t.status }
    const snap = { ...base, ...fn(base) }
    return { ...t, snap, runId: snap.runId, status: snap.status }
  })
  return { chats, startingChat: c.startingChat === target ? null : c.startingChat }
}

/** The status to show for a whole project: a working chat wins over the one on screen. */
export function overallStatus(p: ChatFields | undefined): RunStatus | null {
  if (!p) return null
  if (isBusy(p.status)) return p.status
  return p.chats.find((t) => t.key !== p.chat && isBusy(t.status))?.status ?? p.status
}
