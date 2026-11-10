import type { RunStatus } from './types'

/**
 * Messages typed while Dahl works. A "steer" was handed to the running task and shows until the task reads it at its
 * next step. A "queued" message waits for the task to finish and is then sent as the next turn. "urgent" marks a
 * message sent with "stop and send": the task was cancelled for it, so it goes out even though the run did not complete.
 */
export interface OutMsg {
  id: string
  runId: string
  text: string
  kind: 'steer' | 'queued'
  urgent?: boolean
  mcpServers?: string[] | 'all'
}

export type SendHow = 'steer' | 'queue' | 'stop'

/** Which way a key press sends while a task runs: Enter tells Dahl now, Alt+Enter waits for the task, Ctrl+Enter stops it. */
export function sendHow(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }): SendHow {
  if (e.ctrlKey || e.metaKey) return 'stop'
  return e.altKey ? 'queue' : 'steer'
}

/** Ids of steered messages the task has already read (the runner adds them to the transcript with their steerId). */
export function seenSteers(transcript: readonly { steerId?: string }[]): Set<string> {
  const s = new Set<string>()
  for (const t of transcript) if (t.steerId) s.add(t.steerId)
  return s
}

/** Chips to show for a run: steers the task has not read yet, and queued messages. */
export function visibleOut(items: readonly OutMsg[], runId: string | null, seen: ReadonlySet<string>): OutMsg[] {
  if (!runId) return []
  return items.filter((m) => m.runId === runId && !(m.kind === 'steer' && seen.has(m.id)))
}

/**
 * When a run stops: steers it read are dropped, and unread ones become queued so nothing the user typed is lost (a
 * pause or a failure ends the run before the next step). Everything left is sent now when the task completed, or when
 * the user chose "stop and send"; after a pause, failure or plain cancel it stays on screen for the user to send.
 */
export function settleOut(items: readonly OutMsg[], runId: string, seen: ReadonlySet<string>, status: RunStatus | null): { items: OutMsg[]; send: OutMsg[] } {
  const rest: OutMsg[] = []
  const left: OutMsg[] = []
  for (const m of items) {
    if (m.runId !== runId) rest.push(m)
    else if (!(m.kind === 'steer' && seen.has(m.id))) left.push(m.kind === 'steer' ? { ...m, kind: 'queued' } : m)
  }
  const go = status === 'completed' || (status === 'cancelled' && left.some((m) => m.urgent))
  return go ? { items: rest, send: left } : { items: [...rest, ...left], send: [] }
}

/** Several waiting messages go out as one turn, in the order they were typed. */
export function joinOut(msgs: readonly OutMsg[]): { text: string; mcpServers?: string[] | 'all' } {
  return { text: msgs.map((m) => m.text).join('\n\n'), mcpServers: msgs.find((m) => m.mcpServers)?.mcpServers }
}
