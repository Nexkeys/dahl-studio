import type { CostTally, QualityPreset, ThinkingLevel } from './types'

/** Cost helpers shared by the main process and the UI. */

/** The day the list prices in src/main/priceTable.ts were copied from the providers' pricing pages. */
export const PRICES_CHECKED = '2026-11-07'

/** Thinking level each quality preset selects (the composer switch writes it to settings.thinking). */
export const PRESET_THINKING: Record<QualityPreset, ThinkingLevel> = { economy: 'low', balanced: 'medium', best: 'high' }

/** Local calendar date, YYYY-MM-DD (budgets and "today" follow the user's clock, not UTC). */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emptyTally(): CostTally {
  return { usd: 0, requests: 0, unknown: 0, estimated: false, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }
}

export function mergeTally(into: CostTally, add: CostTally | undefined): CostTally {
  if (!add) return into
  for (const k of ['usd', 'requests', 'unknown', 'inputTokens', 'outputTokens', 'cachedTokens', 'cacheWriteTokens'] as const) into[k] += add[k] ?? 0
  into.estimated = into.estimated || add.estimated
  return into
}

/** "$0.042", "<$0.001", "~$1.20" (estimate from list prices), "$0.04+" (some requests had no known price), "unknown" */
export function formatUsd(t: Pick<CostTally, 'usd' | 'requests' | 'unknown' | 'estimated'>): string {
  if (t.requests > 0 && t.unknown === t.requests) return 'unknown'
  const v = t.usd
  const s = v === 0 ? '$0' : v < 0.001 ? '<$0.001' : v < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`
  return `${t.estimated && v > 0 ? '~' : ''}${s}${t.unknown ? '+' : ''}`
}

/** One line for a tooltip: what the number is made of. */
export function describeTally(t: CostTally): string {
  const parts = [`${t.requests} request${t.requests === 1 ? '' : 's'}`, `${t.inputTokens.toLocaleString('en-US')} input tokens`, `${t.outputTokens.toLocaleString('en-US')} output tokens`]
  if (t.cachedTokens) parts.push(`${t.cachedTokens.toLocaleString('en-US')} read from cache`)
  if (t.cacheWriteTokens) parts.push(`${t.cacheWriteTokens.toLocaleString('en-US')} written to cache`)
  const notes: string[] = []
  if (t.estimated) notes.push('estimated')
  if (t.unknown) notes.push(`${t.unknown} request${t.unknown === 1 ? '' : 's'} with unknown price not included`)
  return `${parts.join(', ')}${notes.length ? ` (${notes.join('; ')})` : ''}`
}
