/**
 * List prices in USD per 1M tokens, copied from each provider's official pricing page on PRICES_CHECKED.
 * Only models whose price was confirmed on that page are listed; anything else shows as "unknown" in the app.
 * Costs computed from this table are estimates (the provider's invoice is authoritative), and the UI says so.
 * Model ids are exact API ids (Anthropic dated ids like claude-opus-4-1-20250805 are matched without the date).
 * Update PRICES_CHECKED (src/shared/cost.ts) whenever these are re-checked.
 */
export { PRICES_CHECKED } from '@shared/cost'

export const PRICE_SOURCES: Record<string, string> = {
  openai: 'https://developers.openai.com/api/docs/pricing',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  gemini: 'https://ai.google.dev/gemini-api/docs/pricing',
  groq: 'https://console.groq.com/docs/models',
  dahl: 'Dahl API error message: "$0.02 per 1M tokens (in + out + cached) on any model"'
}

export interface Rate {
  input: number
  output: number
  /** cache reads (OpenAI "cached input", Anthropic "cache hits", Gemini "context caching") */
  cached?: number
  /** cache writes (Anthropic 5-minute writes, OpenAI 30-minute writes) */
  cacheWrite?: number
}

export interface PriceEntry extends Rate {
  provider: string
  model: string
  /** prompts with more input tokens than `above` pay these prices instead */
  long?: Rate & { above: number }
  /** inclusive local dates (YYYY-MM-DD) for prices the provider announced as time-limited */
  from?: string
  until?: string
  note?: string
}

type R = [input: number, output: number, cached?: number, cacheWrite?: number]
const rate = ([input, output, cached, cacheWrite]: R): Rate => ({ input, output, ...(cached !== undefined ? { cached } : {}), ...(cacheWrite !== undefined ? { cacheWrite } : {}) })
const p = (provider: string, model: string, r: R, extra: Omit<PriceEntry, 'provider' | 'model' | keyof Rate> = {}): PriceEntry => ({ provider, model, ...rate(r), ...extra })
const long = (above: number, r: R): PriceEntry['long'] => ({ above, ...rate(r) })

// Anthropic: base input, output, cache hits, 5-minute cache writes (Dahl Studio uses 5-minute breakpoints)
const A = (model: string, r: R, extra?: Omit<PriceEntry, 'provider' | 'model' | keyof Rate>) => p('anthropic', model, r, extra)
// OpenAI: input, output, cached input, 30-minute write; "long context" means more than 272K input tokens
const O = (model: string, r: R, extra?: Omit<PriceEntry, 'provider' | 'model' | keyof Rate>) => p('openai', model, r, extra)
const OL = 272_000
// Gemini: paid tier, text/image/video input; the free tier costs nothing, so these overstate free-tier use
const G = (model: string, r: R, extra?: Omit<PriceEntry, 'provider' | 'model' | keyof Rate>) => p('gemini', model, r, extra)

export const PRICE_TABLE: PriceEntry[] = [
  A('claude-fable-5-1', [10, 50, 0.25, 12.5]),
  A('claude-mythos-5-1', [10, 50, 0.25, 12.5], { note: 'limited availability' }),
  A('claude-fable-5', [10, 50, 1, 12.5]),
  A('claude-mythos-5', [10, 50, 1, 12.5], { note: 'limited availability' }),
  A('claude-opus-5-5', [4, 20, 0.2, 5]),
  A('claude-opus-5', [5, 25, 0.5, 6.25]),
  A('claude-opus-4-8', [5, 25, 0.5, 6.25]),
  A('claude-opus-4-7', [5, 25, 0.5, 6.25]),
  A('claude-opus-4-6', [5, 25, 0.5, 6.25]),
  A('claude-opus-4-5', [5, 25, 0.5, 6.25]),
  A('claude-opus-4-1', [15, 75, 1.5, 18.75]),
  A('claude-opus-4', [15, 75, 1.5, 18.75]),
  A('claude-sonnet-5-5', [2, 10, 0.1, 2.5]),
  A('claude-sonnet-5', [2, 10, 0.2, 2.5]),
  A('claude-sonnet-4-6', [3, 15, 0.3, 3.75]),
  A('claude-sonnet-4-5', [3, 15, 0.3, 3.75]),
  A('claude-sonnet-4', [3, 15, 0.3, 3.75]),
  A('claude-haiku-5-5', [0.1, 0.5, 0.01, 0.125], { long: long(100_000, [0.5, 2.5, 0.05, 0.625]) }),
  A('claude-haiku-4-5', [1, 5, 0.1, 1.25]),

  O('gpt-6-astra', [10, 50, 1, 12.5], { long: long(OL, [20, 75, 2, 25]) }),
  O('gpt-6.1-sol', [2, 10, 0.1, 2.5], { long: long(OL, [4, 15, 0.2, 5]) }),
  O('gpt-6.1-terra', [1, 5, 0.05, 1.25], { long: long(OL, [2, 7.5, 0.1, 2.5]) }),
  O('gpt-6-sol', [2, 10, 0.2, 2.5], { long: long(OL, [4, 15, 0.4, 5]) }),
  O('gpt-6-luna', [0.1, 0.5, 0.01, 0.125], { long: long(OL, [0.2, 0.75, 0.02, 0.25]) }),
  // promotional price; the page names no price after it ends, so it becomes "unknown" then
  O('gpt-5.6-sol', [4, 20, 0.4, 5], { long: long(OL, [8, 30, 0.8, 10]), until: '2026-11-30', note: 'promotional price' }),
  O('gpt-5.6-terra', [2, 12, 0.2, 2.5], { long: long(OL, [4, 18, 0.4, 5]) }),
  O('gpt-5.6-luna', [0.2, 1.2, 0.02, 0.25], { long: long(OL, [0.4, 1.8, 0.04, 0.5]) }),
  O('gpt-5.5', [5, 30, 0.5], { long: long(OL, [10, 45, 1]) }),
  O('gpt-5.5-pro', [30, 180], { long: long(OL, [60, 270]) }),
  O('gpt-5.4', [2.5, 15, 0.25], { long: long(OL, [5, 22.5, 0.5]) }),
  O('gpt-5.4-pro', [30, 180], { long: long(OL, [60, 270]) }),
  O('gpt-5.4-mini', [0.75, 4.5, 0.075]),
  O('gpt-5.4-nano', [0.2, 1.25, 0.02]),
  O('gpt-5.2', [1.75, 14, 0.175]),
  O('gpt-5.2-pro', [21, 168]),
  O('gpt-5.1', [1.25, 10, 0.125]),
  O('gpt-5', [1.25, 10, 0.125]),
  O('gpt-5-mini', [0.25, 2, 0.025]),
  O('gpt-5-nano', [0.05, 0.4, 0.005]),
  O('gpt-5-pro', [15, 120]),
  O('gpt-4.1', [2, 8, 0.5]),
  O('gpt-4.1-mini', [0.4, 1.6, 0.1]),
  O('gpt-4o', [2.5, 10, 1.25]),
  O('gpt-4o-mini', [0.15, 0.6, 0.075]),
  O('o3-pro', [20, 80]),
  O('o3', [2, 8, 0.5]),

  G('gemini-4-argon', [2, 10, 0.1], { until: '2026-11-30' }),
  G('gemini-4-argon', [4, 20, 0.2], { from: '2026-12-01' }),
  G('gemini-3.8-flash', [0.75, 3.75, 0.075], { until: '2026-12-31' }),
  G('gemini-3.8-flash', [1.5, 7.5, 0.15], { from: '2027-01-01' }),
  G('gemini-3.6-flash', [0.75, 3.75, 0.075], { until: '2026-12-31' }),
  G('gemini-3.6-flash', [1.5, 7.5, 0.15], { from: '2027-01-01' }),
  G('gemini-3.5-flash-lite', [0.3, 2.5, 0.03]),
  G('gemini-3.1-pro-preview', [2, 12, 0.2], { long: long(200_000, [4, 18, 0.4]) }),
  G('gemini-3.1-flash-lite', [0.25, 1.5, 0.025]),
  G('gemini-3-flash-preview', [0.5, 3, 0.05]),
  G('gemini-2.5-pro', [1.25, 10, 0.125], { long: long(200_000, [2.5, 15, 0.25]) }),
  G('gemini-2.5-flash', [0.3, 2.5, 0.03]),
  G('gemini-2.5-flash-lite', [0.1, 0.4, 0.01]),

  // Groq: cached input is 50% of input (https://console.groq.com/docs/prompt-caching), only on the gpt-oss models
  p('groq', 'openai/gpt-oss-120b', [0.15, 0.6, 0.075]),
  p('groq', 'openai/gpt-oss-20b', [0.075, 0.3, 0.0375]),
  p('groq', 'openai/gpt-oss-safeguard-20b', [0.075, 0.3, 0.0375]),
  p('groq', 'qwen/qwen3.8-27b', [0.8, 4])
]

/** Dahl: one flat rate on every model and on all tokens (input, output and cached), from Dahl's own error message. */
export const DAHL_USD_PER_M = 0.02
/** Providers that run on this PC: no API charges. */
export const LOCAL_PROVIDERS = ['ollama', 'lmstudio']
