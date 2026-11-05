import type { AgentEvent } from '@shared/types'

/**
 * Streamed tokens arrive one per callback; sending each as its own IPC message costs more than drawing it. Deltas of
 * the same run and kind are merged and sent at most every `intervalMs` (16 ms, one frame). Any other event flushes
 * the pending deltas first, so the renderer always sees events in order.
 */
export function batchDeltas(send: (e: AgentEvent) => void, intervalMs = 16): (e: AgentEvent) => void {
  const pending = new Map<string, AgentEvent>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    for (const e of pending.values()) send(e)
    pending.clear()
  }
  return (e) => {
    if (e.type === 'delta' || e.type === 'reasoning_delta') {
      const key = `${e.runId}|${e.type}`
      const cur = pending.get(key)
      if (cur) cur.delta = (cur.delta ?? '') + (e.delta ?? '')
      else pending.set(key, { ...e })
      timer ??= setTimeout(flush, intervalMs)
      return
    }
    flush()
    send(e)
  }
}
