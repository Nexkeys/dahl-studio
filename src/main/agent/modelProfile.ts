import type { ChatMessage } from '@shared/types'

/**
 * Model variance: the same prompt gives very different quality across model families, mostly because each family is
 * tuned for its own sampling settings and some need their own reasoning sent back during a tool loop. Dahl Studio
 * applies each family's published recommendation instead of one setting for all, and gives smaller models stricter
 * working rules. Sources (checked 2026-11): DeepSeek API docs (temperature guide; V3 model card mapping), MiniMax M2
 * model card (temperature 1.0, top_p 0.95, top_k 40; keep <think> content in history), Qwen3 and Qwen3-Coder model cards,
 * Z.ai GLM docs, Moonshot Kimi K2 docs, OpenAI gpt-oss guide, Mistral Devstral card, Google Gemini 3 guide (keep 1.0).
 */

export type Tier = 'strong' | 'standard' | 'light'
export type Replay = 'none' | 'think_tags' | 'reasoning_content'

export interface ModelProfile {
  family: string
  tier: Tier
  temperature?: number
  topP?: number
  topK?: number
  /** how the family wants its own reasoning sent back inside a tool loop */
  replay: Replay
}

/** Providers whose own defaults are already right for their models (and whose reasoning models reject temperature). */
const OWN_DEFAULTS = new Set(['openai', 'anthropic', 'gemini'])
/** Providers known to accept top_k on an OpenAI-style request. Others get temperature and top_p only. */
const TAKES_TOP_K = new Set(['dahl', 'nvidia', 'openrouter', 'ollama', 'lmstudio'])

function sizeB(id: string): number | null {
  const m = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?:$|[^a-z0-9])/i.exec(id)
  return m ? Number(m[1]) : null
}

function bySize(id: string, fallback: Tier): Tier {
  const b = sizeB(id)
  if (b === null) return fallback
  return b < 20 ? 'light' : b < 100 ? 'standard' : 'strong'
}

/** The profile for a model key such as "dahl:minimax-m2.7" or "openrouter:deepseek/deepseek-v3.2". */
export function profileFor(modelKey: string): ModelProfile {
  const sep = modelKey.indexOf(':')
  const provider = sep > 0 ? modelKey.slice(0, sep) : 'dahl'
  const id = (sep > 0 ? modelKey.slice(sep + 1) : modelKey).toLowerCase()
  const local = provider === 'ollama' || provider === 'lmstudio'
  const p = (family: string, tier: Tier, s: Partial<ModelProfile> = {}): ModelProfile => ({ family, tier, replay: 'none', ...s })

  if (/claude/.test(id)) return p('claude', /haiku/.test(id) ? 'standard' : 'strong')
  if (/gpt-oss/.test(id)) return p('gpt-oss', /(^|[^0-9])20b/.test(id) ? 'light' : 'standard', { temperature: 1.0, topP: 1.0 })
  if (/(^|\/)(gpt-|o\d)/.test(id)) return p('openai', /nano/.test(id) ? 'light' : /mini/.test(id) ? 'standard' : 'strong')
  if (/gemini|gemma/.test(id)) return p(/gemma/.test(id) ? 'gemma' : 'gemini', /gemma|lite/.test(id) ? 'light' : /flash/.test(id) ? 'standard' : 'strong')
  if (/deepseek/.test(id)) {
    const thinking = /reasoner|r1|think/.test(id)
    // the official API maps temperature (0.0 is its coding setting); other hosts pass it straight to the model (0.3)
    return p('deepseek', /lite|distill/.test(id) ? bySize(id, 'light') : 'strong', thinking ? { replay: 'reasoning_content' } : { temperature: provider === 'deepseek' ? 0.0 : 0.3, replay: 'reasoning_content' })
  }
  if (/minimax/.test(id)) return p('minimax', 'strong', { temperature: 1.0, topP: 0.95, topK: 40, replay: 'think_tags' })
  if (/qwen3?-?coder/.test(id)) return p('qwen-coder', bySize(id, /plus|480b/.test(id) ? 'strong' : 'standard'), { temperature: 0.7, topP: 0.8, topK: 20 })
  if (/qwq|qwen3.*think/.test(id)) return p('qwen-thinking', bySize(id, 'standard'), { temperature: 0.6, topP: 0.95, topK: 20 })
  if (/qwen/.test(id)) return p('qwen', bySize(id, 'standard'), { temperature: 0.7, topP: 0.8, topK: 20 })
  if (/glm/.test(id)) return p('glm', /air|flash|9b/.test(id) ? 'standard' : 'strong', { temperature: 1.0, topP: 0.95 })
  if (/kimi/.test(id)) return /think/.test(id) ? p('kimi-thinking', 'strong', { temperature: 1.0, replay: 'reasoning_content' }) : p('kimi', 'strong', { temperature: 0.6 })
  if (/devstral/.test(id)) return p('devstral', /small/.test(id) ? 'light' : 'standard', { temperature: 0.15 })
  if (/mistral|codestral|magistral/.test(id)) return p('mistral', /small|tiny|ministral/.test(id) ? 'light' : 'standard')
  if (/llama/.test(id)) return p('llama', bySize(id, /maverick|405b/.test(id) ? 'standard' : 'light'), { temperature: 0.6, topP: 0.9 })
  if (/grok/.test(id)) return p('grok', /fast|mini/.test(id) ? 'standard' : 'strong')
  if (/phi|smol|tinyllama/.test(id)) return p('small', 'light')
  return p('other', bySize(id, local ? 'light' : 'standard'))
}

/** What a model refused once (HTTP 400), remembered for the rest of the session so the next request goes through. */
export interface Compat { noSampling?: boolean; noReplay?: boolean }
const refused = new Map<string, Compat>()
export const compatFor = (modelKey: string): Compat => refused.get(modelKey) ?? {}
export function markRefused(modelKey: string, c: Compat): void {
  refused.set(modelKey, { ...compatFor(modelKey), ...c })
}

/**
 * After an HTTP 400: if this request carried tuned sampling or replayed reasoning, remember that the model refuses them
 * and return true so the caller retries once with plain provider defaults. False when there was nothing to drop.
 */
export function dropTuning(modelKey: string, prof: ModelProfile, messages: ChatMessage[]): boolean {
  const c = compatFor(modelKey)
  const sampling = Object.keys(samplingFor(modelKey, prof, c)).length > 0
  const replay = prof.replay !== 'none' && !c.noReplay && messages.some((m) => m.thought)
  if (!sampling && !replay) return false
  markRefused(modelKey, { noSampling: sampling || c.noSampling, noReplay: replay || c.noReplay })
  return true
}

/** Sampling fields for one request, or {} when the provider's defaults apply or the model refused them before. */
export function samplingFor(modelKey: string, prof: ModelProfile, compat: Compat = compatFor(modelKey)): { temperature?: number; topP?: number; topK?: number } {
  const provider = modelKey.includes(':') ? modelKey.slice(0, modelKey.indexOf(':')) : 'dahl'
  if (compat.noSampling || OWN_DEFAULTS.has(provider)) return {}
  const out: { temperature?: number; topP?: number; topK?: number } = {}
  if (prof.temperature !== undefined) out.temperature = prof.temperature
  if (prof.topP !== undefined) out.topP = prof.topP
  if (prof.topK !== undefined && TAKES_TOP_K.has(provider)) out.topK = prof.topK
  return out
}

/**
 * Send the model's own reasoning back inside the current tool loop (the assistant messages after the last user
 * message), the way its family expects it. Earlier turns are sent without it: their reasoning is no longer needed and
 * only costs tokens. Messages are copied, never changed in place.
 */
export function withReplay(messages: ChatMessage[], replay: Replay): ChatMessage[] {
  if (replay === 'none') return messages
  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { lastUser = i; break }
  return messages.map((m, i) => {
    if (i <= lastUser || m.role !== 'assistant' || !m.thought) return m
    if (replay === 'reasoning_content') return { ...m, reasoning_content: m.thought }
    const text = typeof m.content === 'string' ? m.content : ''
    return { ...m, content: `<think>\n${m.thought}\n</think>\n\n${text}` }
  })
}

/** Working rules added to the system prompt by tier. Strong models get none: extra rules only slow them down. */
export function tierGuidance(tier: Tier): string {
  if (tier === 'light')
    return [
      'Working rules for this model (follow them exactly):',
      '- Work in small steps. Make one change, then check it before the next.',
      '- Read a file with read_file before you edit it, and edit with edit_file using text copied exactly from what you read.',
      '- Call tools for facts. Never describe a file, command output or test result you did not get from a tool in this task.',
      '- After changing code, run the project\'s check (build, tests or linter) and read the result before saying it works.',
      '- If you are stuck or unsure, say so plainly and say what you tried. Do not guess.'
    ].join('\n')
  if (tier === 'standard')
    return 'Working rules: plan briefly, read before you edit, and verify with a command before you say something works. Only state results you saw in a tool output.'
  return ''
}
