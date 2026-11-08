import path from 'node:path'
import type { CostDay, CostTally, KeyUsageLocal } from '@shared/types'
import { emptyTally, mergeTally } from '@shared/cost'
import { addToTally, costOf, localDate, type CostResult } from './pricing'
import { readJson, writeJson } from './util'

const KEEP_DAYS = 90

/**
 * Spend per local day and provider, from every model request the app makes (tasks, helpers, image reading, memory).
 * Stored in <app data>/usage/costs.json. Costs are the provider's own figure when it reports one (OpenRouter),
 * otherwise estimates from the dated price table; requests with an unknown price are counted but not priced.
 */
export class CostLedger {
  private file: string
  private data: { days: Record<string, Record<string, CostTally>> } | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(appDataDir: string) {
    this.file = path.join(appDataDir, 'usage', 'costs.json')
  }

  private async load(): Promise<{ days: Record<string, Record<string, CostTally>> }> {
    if (!this.data) {
      this.data = await readJson(this.file, { days: {} as Record<string, Record<string, CostTally>> })
      this.data.days ??= {}
    }
    return this.data
  }

  /** Record one successful request. `provider` comes from the key slot; `model` may or may not carry the provider prefix. */
  async record(provider: string, u: Partial<KeyUsageLocal> & { ok: boolean }, date = localDate()): Promise<CostResult | null> {
    if (!u.ok) return null
    const model = u.lastModel?.startsWith(`${provider}:`) ? u.lastModel : `${provider}:${u.lastModel ?? ''}`
    const counts = { promptTokens: u.promptTokens ?? 0, completionTokens: u.completionTokens ?? 0, cachedTokens: u.cachedTokens, cacheWriteTokens: u.cacheWriteTokens, reportedCost: u.costExact ? u.costUsd : null }
    const c = costOf(model, counts, date)
    const d = await this.load()
    const day = (d.days[date] ??= {})
    const t = addToTally((day[provider] ??= emptyTally()), counts, c)
    if (u.estimated) t.estimated = true
    for (const k of Object.keys(d.days).sort().slice(0, -KEEP_DAYS)) delete d.days[k]
    this.saving = this.saving.then(() => writeJson(this.file, d)).catch(() => {})
    await this.saving
    return c
  }

  async day(date = localDate()): Promise<CostDay> {
    const byProvider = (await this.load()).days[date] ?? {}
    const total = emptyTally()
    for (const t of Object.values(byProvider)) mergeTally(total, t)
    return { date, total, byProvider }
  }

  /** The last `n` days that had any requests, newest first. */
  async recent(n = 7): Promise<CostDay[]> {
    const dates = Object.keys((await this.load()).days).sort().reverse().slice(0, n)
    return Promise.all(dates.map((d) => this.day(d)))
  }

  async spentToday(): Promise<number> {
    return (await this.day()).total.usd
  }
}
