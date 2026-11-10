import type { CostTally, PriceRow } from '@shared/types'
import { DAHL_USD_PER_M, LOCAL_PROVIDERS, PRICE_SOURCES, PRICE_TABLE, PRICES_CHECKED, type PriceEntry, type Rate } from './priceTable'

export { PRICES_CHECKED } from './priceTable'
export { emptyTally, formatUsd, mergeTally } from '@shared/cost'
import { localDate } from '@shared/cost'
export { localDate }

/**
 * Token counts of one request. promptTokens is ALL input, including cache reads and cache writes (adapters convert
 * Anthropic's separate counters to this). reportedCost is the provider's own charge in USD (OpenRouter usage.cost).
 */
export interface UsageCounts {
  promptTokens: number
  completionTokens: number
  cachedTokens?: number
  cacheWriteTokens?: number
  reportedCost?: number | null
}

export interface CostResult {
  /** null = the price is unknown (never guessed) */
  usd: number | null
  /** reported by the provider, or certain (local models) */
  exact: boolean
  source: 'provider' | 'table' | 'dahl' | 'local' | 'unknown'
}

export function splitModelKey(key: string): { provider: string; id: string } {
  const i = key.indexOf(':')
  return i > 0 ? { provider: key.slice(0, i), id: key.slice(i + 1) } : { provider: 'dahl', id: key }
}

/** Anthropic ids carry a release date (claude-opus-4-1-20250805) that names the same model as the table row. */
function normalise(provider: string, id: string): string {
  const s = id.toLowerCase().replace(/^models\//, '')
  return provider === 'anthropic' ? s.replace(/-(\d{8}|latest)$/, '') : s
}

/** The table row for a model on a date, or undefined when its price was not confirmed. */
export function findPrice(modelKey: string, date = localDate()): PriceEntry | undefined {
  const { provider, id } = splitModelKey(modelKey)
  const m = normalise(provider, id)
  return PRICE_TABLE.find((e) => e.provider === provider && e.model === m && (!e.from || date >= e.from) && (!e.until || date <= e.until))
}

const perM = (tokens: number, usdPerM: number): number => (tokens * usdPerM) / 1_000_000

/** Cost of one request. Unknown prices return usd null; nothing is guessed. */
export function costOf(modelKey: string, u: UsageCounts, date = localDate()): CostResult {
  if (typeof u.reportedCost === 'number' && Number.isFinite(u.reportedCost) && u.reportedCost >= 0) return { usd: u.reportedCost, exact: true, source: 'provider' }
  const { provider } = splitModelKey(modelKey)
  if (LOCAL_PROVIDERS.includes(provider)) return { usd: 0, exact: true, source: 'local' }
  if (provider === 'dahl') return { usd: perM(u.promptTokens + u.completionTokens, DAHL_USD_PER_M), exact: false, source: 'dahl' }
  const e = findPrice(modelKey, date)
  if (!e) return { usd: null, exact: false, source: 'unknown' }
  const r: Rate = e.long && u.promptTokens > e.long.above ? e.long : e
  const cached = Math.max(0, u.cachedTokens ?? 0)
  const writes = Math.max(0, u.cacheWriteTokens ?? 0)
  const plain = Math.max(0, u.promptTokens - cached - writes)
  const usd = perM(plain, r.input) + perM(cached, r.cached ?? r.input) + perM(writes, r.cacheWrite ?? r.input) + perM(u.completionTokens, r.output)
  return { usd, exact: false, source: 'table' }
}

/** Input-only cost of a request of this size (no cache discount: an upper bound), for budget checks. */
export function inputCostOf(modelKey: string, promptTokens: number, date = localDate()): number | null {
  return costOf(modelKey, { promptTokens, completionTokens: 0 }, date).usd
}

/** Add one request to a tally (mutates and returns it). */
export function addToTally(t: CostTally, u: UsageCounts, c: CostResult): CostTally {
  t.requests += 1
  t.inputTokens += u.promptTokens
  t.outputTokens += u.completionTokens
  t.cachedTokens += u.cachedTokens ?? 0
  t.cacheWriteTokens += u.cacheWriteTokens ?? 0
  if (c.usd === null) t.unknown += 1
  else {
    t.usd += c.usd
    if (!c.exact) t.estimated = true
  }
  return t
}

/** The price list as shown in Settings > Usage. */
export function priceRows(): PriceRow[] {
  const fmt = (r: Rate) => `$${r.input} in, $${r.output} out${r.cached !== undefined ? `, $${r.cached} cached` : ''}`
  const rows: PriceRow[] = PRICE_TABLE.map((e) => ({
    provider: e.provider, model: e.model, input: e.input, output: e.output, cached: e.cached, cacheWrite: e.cacheWrite,
    tier: e.long ? `over ${e.long.above.toLocaleString('en-US')} input tokens: ${fmt(e.long)}` : undefined,
    period: e.from && e.until ? `${e.from} to ${e.until}` : e.from ? `from ${e.from}` : e.until ? `until ${e.until}` : undefined,
    source: PRICE_SOURCES[e.provider], checked: PRICES_CHECKED, note: e.note
  }))
  rows.unshift({ provider: 'dahl', model: 'all models', input: DAHL_USD_PER_M, output: DAHL_USD_PER_M, cached: DAHL_USD_PER_M, source: PRICE_SOURCES.dahl, checked: PRICES_CHECKED, note: 'from Dahl\'s message; the Dahl docs say token packages cost around $0.03 per 1M' })
  return rows
}
