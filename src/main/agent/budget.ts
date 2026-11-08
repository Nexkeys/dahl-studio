import type { AgentRole, ChatMessage, CostTally, ModelRole, RunState, Settings } from '@shared/types'
import { formatUsd } from '@shared/cost'

export { PRESET_THINKING } from '@shared/cost'

/** Which per-role model setting each agent role uses (null: the main model). */
export const ROLE_OF_AGENT: Record<AgentRole, ModelRole | null> = {
  lead: null, architect: null,
  implementer: 'helpers', debugger: 'helpers', test_engineer: 'helpers',
  code_reviewer: 'checker', security_reviewer: 'checker',
  researcher: 'research'
}
const AGENT_ROLES: ModelRole[] = ['research', 'helpers', 'checker']

type RoleSettings = Pick<Settings, 'qualityPreset' | 'roleModels'>

/**
 * The model a role should use: its own setting when one is chosen ("same as main" otherwise). Best quality runs
 * every agent on the main model and ignores cheaper agent role models; image reading and autocomplete keep theirs.
 */
export function resolveModelForRole(role: AgentRole | ModelRole, run: Pick<RunState, 'model'>, settings: RoleSettings): string {
  const r = role in ROLE_OF_AGENT ? ROLE_OF_AGENT[role as AgentRole] : (role as ModelRole)
  if (!r) return run.model
  if (settings.qualityPreset === 'best' && AGENT_ROLES.includes(r)) return run.model
  return settings.roleModels?.[r] || run.model
}

/** Economy runs fewer helpers at once and sends fewer images per request. */
export function maxHelpers(settings: Pick<Settings, 'qualityPreset'>): number {
  return settings.qualityPreset === 'economy' ? 2 : 6
}
export function maxImages(settings: Pick<Settings, 'qualityPreset'>): number {
  return settings.qualityPreset === 'economy' ? 2 : Number.POSITIVE_INFINITY
}

export function countImages(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image').length : 0), 0)
}

/** Keep only the newest `max` images; older ones become a short text note (the history itself is not changed). */
export function limitImages(messages: ChatMessage[], max: number): ChatMessage[] {
  if (countImages(messages) <= max) return messages
  let keep = max
  const out = messages.map((m) => m)
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (!Array.isArray(m.content) || !m.content.some((p) => p.type === 'image')) continue
    const parts = [...m.content]
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j]
      if (p.type !== 'image') continue
      if (keep > 0) keep--
      else parts[j] = { type: 'text', text: `[image ${p.name ?? ''} not sent again to save cost (Economy); use analyze_image if you need it]` }
    }
    out[i] = { ...m, content: parts }
  }
  return out
}

/** Rough input size in tokens (text characters / 4; image data is not counted here, images are counted separately). */
export function estimateInputTokens(messages: ChatMessage[], tools: unknown[] = []): number {
  let chars = JSON.stringify(tools).length
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length
    else if (Array.isArray(m.content)) for (const p of m.content) chars += p.type === 'text' ? p.text.length : 0
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length
  }
  return Math.ceil(chars / 4)
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string }

export interface BudgetState {
  /** this request so far (lead and helpers) */
  task: CostTally
  /** everything spent today on this PC (all chats), USD */
  today: number
  /** expected cost of the next model call, USD, or null when the model's price is unknown */
  next: number | null
}

const usd = (v: number): string => formatUsd({ usd: v, requests: 1, unknown: 0, estimated: false })

/**
 * Called before every model call. A limit "would be exceeded" when what is already spent plus the expected cost of
 * the next call goes over it. Unknown prices cannot be counted, so they never trigger a stop on their own.
 */
export function checkBudget(s: BudgetState, settings: Pick<Settings, 'budgetTaskUsd' | 'budgetDayUsd'>): BudgetCheck {
  const next = s.next ?? 0
  const task = settings.budgetTaskUsd
  if (typeof task === 'number' && task > 0 && s.task.usd + next > task)
    return { ok: false, reason: `Budget reached: this task has used ${usd(s.task.usd)} of its ${usd(task)} limit${next ? ` and the next step would cost about ${usd(next)}` : ''}. Its progress is saved. Send "Continue" to allow another ${usd(task)}, or change the limit in Settings > Usage.` }
  const day = settings.budgetDayUsd
  if (typeof day === 'number' && day > 0 && s.today + next > day)
    return { ok: false, reason: `Budget reached: ${usd(s.today)} spent today of the ${usd(day)} daily limit${next ? ` and the next step would cost about ${usd(next)}` : ''}. Its progress is saved. Raise the daily limit in Settings > Usage to continue today.` }
  return { ok: true }
}

/** Notes shown before an expensive step (each kind once per task). */
export function sizeWarnings(size: { inputTokens: number; images: number; costUsd: number | null }, settings: Pick<Settings, 'warnInputTokens' | 'warnImages'>, warned: Set<string>): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = []
  const cost = size.costUsd ? `, about ${usd(size.costUsd)} in input at list prices` : ''
  if (settings.warnInputTokens > 0 && size.inputTokens > settings.warnInputTokens && !warned.has('input'))
    out.push({ key: 'input', text: `Large request: this step sends about ${size.inputTokens.toLocaleString('en-US')} input tokens${cost} (notes start above ${settings.warnInputTokens.toLocaleString('en-US')}).` })
  if (settings.warnImages > 0 && size.images > settings.warnImages && !warned.has('images'))
    out.push({ key: 'images', text: `This step sends ${size.images} images to the model (notes start above ${settings.warnImages}). Images are billed as input tokens.` })
  return out
}

export function helpersWarning(count: number, settings: Pick<Settings, 'warnHelpers'>): string | null {
  return settings.warnHelpers > 0 && count > settings.warnHelpers ? `Starting ${count} helper agents at once (notes start above ${settings.warnHelpers}). Each one makes its own model calls.` : null
}
