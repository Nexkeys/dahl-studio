import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { ChiefFollowup } from '@shared/types'
import { atomicWrite, nowIso, readJson, shortId, writeJson } from '../util'

// Chief of Staff data in the app data folder (not in any project): follow-ups as JSON, goals as Markdown, and when
// the last briefing was given (so the next one can say what agents did since).

export const GOALS_TEMPLATE = `# Goals

The source of truth for what matters. Dahl's Chief of Staff checks new requests and the week against this file.

## This quarter
- (outcome, by when)

## This week
- (top 3 priorities, most important first)

## Not now
- (things you decided to park)
`

/** YYYY-MM-DD for a date in local time. */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "2026-11-12", "today", "tomorrow", "in 3 days", "+3d", "next week" -> YYYY-MM-DD; null when it cannot be read. */
export function parseDue(s: string | null | undefined, now = new Date()): string | null {
  const t = (s ?? '').trim().toLowerCase()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Number.isNaN(Date.parse(t)) ? null : t
  const plus = (n: number): string => dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))
  if (t === 'today') return plus(0)
  if (t === 'tomorrow') return plus(1)
  if (t === 'next week') return plus(7)
  const m = /^(?:in\s+)?\+?(\d{1,3})\s*(d|days?|w|weeks?)$/.exec(t)
  return m ? plus(Number(m[1]) * (m[2].startsWith('w') ? 7 : 1)) : null
}

export class ChiefStore {
  constructor(private appDir: string) {}

  private file(name: string): string {
    return path.join(this.appDir, 'chief', name)
  }

  async followups(): Promise<ChiefFollowup[]> {
    return readJson<ChiefFollowup[]>(this.file('followups.json'), [])
  }

  async addFollowup(text: string, o: { due?: string | null; project?: string | null } = {}): Promise<ChiefFollowup> {
    const clean = text.trim().slice(0, 500)
    if (!clean) throw new Error('A follow-up needs text.')
    const due = o.due ? parseDue(o.due) : null
    if (o.due && !due) throw new Error(`Could not read the due date "${o.due}". Use YYYY-MM-DD, today, tomorrow or "in N days".`)
    const all = await this.followups()
    const item: ChiefFollowup = { id: shortId().slice(0, 8), text: clean, project: o.project ?? null, due, createdAt: nowIso(), doneAt: null }
    all.push(item)
    await writeJson(this.file('followups.json'), all)
    return item
  }

  async completeFollowup(id: string): Promise<ChiefFollowup> {
    const all = await this.followups()
    const item = all.find((f) => f.id === id.trim())
    if (!item) throw new Error(`No follow-up with id "${id}". List them first.`)
    item.doneAt ??= nowIso()
    await writeJson(this.file('followups.json'), all)
    return item
  }

  /** Open follow-ups sorted by due date (undated last); `withDone` also returns the completed ones. */
  async listFollowups(o: { project?: string | null; withDone?: boolean } = {}): Promise<ChiefFollowup[]> {
    const key = (p: string | null): string => (p ?? '').toLowerCase()
    return (await this.followups())
      .filter((f) => (o.withDone || !f.doneAt) && (o.project === undefined || key(f.project) === key(o.project)))
      .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt.localeCompare(b.createdAt))
  }

  async goals(): Promise<string | null> {
    return fs.readFile(this.file('goals.md'), 'utf8').catch(() => null)
  }

  async setGoals(md: string): Promise<void> {
    if (!md.trim()) throw new Error('Goals cannot be empty. Read them first and send the whole updated file.')
    await atomicWrite(this.file('goals.md'), md.trim() + '\n')
  }

  async lastBriefing(): Promise<string | null> {
    return (await readJson<{ lastBriefingAt?: string }>(this.file('state.json'), {})).lastBriefingAt ?? null
  }

  async markBriefed(at = nowIso()): Promise<void> {
    await writeJson(this.file('state.json'), { lastBriefingAt: at })
  }
}
