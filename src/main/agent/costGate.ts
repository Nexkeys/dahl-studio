import type { ChatMessage, CostTally, RunState, Settings } from '@shared/types'
import { emptyTally } from '@shared/cost'
import { addToTally, costOf, inputCostOf, type CostResult } from '../pricing'
import { usageCounts, type ChatUsage } from '../providers/usage'
import { checkBudget, countImages, estimateInputTokens, limitImages, maxImages, sizeWarnings } from './budget'

/** Cost bookkeeping for one request (turn) of a task, shared by the lead and its helpers. */
export interface CostState {
  task: CostTally
  /** warning kinds already shown in this request */
  warned: Set<string>
  /** cost of the latest call per model: the best guess for the next one (the context grows slowly between steps) */
  last: Map<string, number | null>
  /** set when a limit stopped an agent; the lead pauses at its next step */
  stop?: string
}

export function newCostState(): CostState {
  return { task: emptyTally(), warned: new Set(), last: new Map() }
}

export interface GateHooks {
  settings: Settings
  /** USD spent today in all chats (Settings > Usage) */
  spentToday: number
  note(text: string, notice: 'cost' | 'budget'): void
  log(text: string): void
  /** ask the user whether to go ahead (only when "ask before expensive steps" is on); true = continue */
  confirm(question: string): Promise<boolean>
}

/**
 * Runs before every model call: drops old images in Economy, notes (or asks about) very large requests and checks the
 * budgets. Returns the messages to send, or a stop reason.
 */
export async function beforeModelCall(st: CostState, model: string, messages: ChatMessage[], tools: unknown[], h: GateHooks): Promise<{ messages: ChatMessage[]; stop?: string }> {
  if (st.stop) return { messages, stop: st.stop }
  const send = limitImages(messages, maxImages(h.settings))
  const inputTokens = estimateInputTokens(send, tools)
  const firstCost = inputCostOf(model, inputTokens)
  const warnings = sizeWarnings({ inputTokens, images: countImages(send), costUsd: firstCost }, h.settings, st.warned)
  for (const w of warnings) {
    st.warned.add(w.key)
    h.note(w.text, 'cost')
    h.log(`Cost warning (${model}): ${w.text}`)
  }
  if (warnings.length && h.settings.confirmExpensive && !(await h.confirm(`${warnings.map((w) => w.text).join(' ')} Go ahead?`))) {
    st.stop = 'Paused before an expensive step, as you asked. Send "Continue" to go ahead anyway, or change the request.'
    return { messages: send, stop: st.stop }
  }
  const b = checkBudget({ task: st.task, today: h.spentToday, next: st.last.get(model) ?? firstCost }, h.settings)
  if (!b.ok) {
    st.stop = b.reason
    h.log(b.reason)
    return { messages: send, stop: b.reason }
  }
  return { messages: send }
}

/** Runs after every model call: adds its cost to this request and to the chat's total. */
export function afterModelCall(st: CostState, run: RunState, model: string, usage: ChatUsage | null | undefined, estimate: { prompt: number; completion: number }): CostResult {
  const u = usageCounts(usage, estimate)
  const c = costOf(model, u)
  addToTally(st.task, u, c)
  run.cost = addToTally(run.cost ?? emptyTally(), u, c)
  if (u.estimatedTokens) st.task.estimated = run.cost.estimated = true
  st.last.set(model, c.usd)
  return c
}
