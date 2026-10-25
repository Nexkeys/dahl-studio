import path from 'node:path'
import type { KeyUsageLocal } from '@shared/types'
import { appendJsonl, nowIso, readJson, writeJson } from '../util'

const EMPTY: KeyUsageLocal = { requests: 0, errors: 0, promptTokens: 0, completionTokens: 0, estimated: false }

/** Locally observed usage per key slot. This is a local measurement, not provider billing. */
export class UsageLedger {
  private file: string
  private log: string
  private data: Record<string, KeyUsageLocal> | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(appDataDir: string) {
    this.file = path.join(appDataDir, 'usage', 'usage.json')
    this.log = path.join(appDataDir, 'usage', 'requests.jsonl')
  }

  async get(): Promise<Record<string, KeyUsageLocal>> {
    if (!this.data) this.data = await readJson<Record<string, KeyUsageLocal>>(this.file, {})
    return this.data
  }

  async record(slot: string, u: Partial<KeyUsageLocal> & { ok: boolean }): Promise<void> {
    const all = await this.get()
    const cur = (all[slot] ??= { ...EMPTY })
    cur.requests += 1
    if (!u.ok) cur.errors += 1
    cur.promptTokens += u.promptTokens ?? 0
    cur.completionTokens += u.completionTokens ?? 0
    if (u.estimated) cur.estimated = true
    cur.lastUsedAt = nowIso()
    if (u.lastModel) cur.lastModel = u.lastModel
    if (u.lastLatencyMs !== undefined) cur.lastLatencyMs = u.lastLatencyMs
    this.saving = this.saving
      .then(() => writeJson(this.file, all))
      .then(() => appendJsonl(this.log, { at: cur.lastUsedAt, slot, ...u }))
      .catch(() => {})
    await this.saving
  }

  async reset(): Promise<void> {
    this.data = {}
    await writeJson(this.file, this.data)
  }
}
