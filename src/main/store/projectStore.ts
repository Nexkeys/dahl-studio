import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { MemoryEntry, RunState, RunSummary } from '@shared/types'
import { atomicWrite, nowIso, readJson, shortId, writeJson } from '../util'

/**
 * Per-project state lives in <project>/.dahl:
 *   memory.json        structured memory entries (also mirrored to memory.md for humans)
 *   memory.md          readable mirror
 *   runs/<id>.json     run manifests = checkpoints (objective, plan, messages, changed files, status)
 *   README.md          explains the folder
 */
export class ProjectStore {
  readonly dir: string
  constructor(public readonly root: string) {
    this.dir = path.join(root, '.dahl')
  }

  async ensure(): Promise<void> {
    await fs.mkdir(path.join(this.dir, 'runs'), { recursive: true })
    const readme = path.join(this.dir, 'README.md')
    try {
      await fs.access(readme)
    } catch {
      await atomicWrite(
        readme,
        '# .dahl\n\nProject-local state written by Dahl Studio: memory notes (memory.json / memory.md) and task checkpoints (runs/).\nSafe to delete. Add `.dahl/` to .gitignore if you do not want to commit it.\n'
      )
    }
  }

  // ---------- memory ----------
  private memFile(): string {
    return path.join(this.dir, 'memory.json')
  }

  async listMemory(): Promise<MemoryEntry[]> {
    return readJson<MemoryEntry[]>(this.memFile(), [])
  }

  async saveMemory(entries: MemoryEntry[]): Promise<void> {
    await this.ensure()
    await writeJson(this.memFile(), entries)
    const md = ['# Project memory', '', ...entries.map((e) => `- ${e.text}${e.tags.length ? `  _(${e.tags.join(', ')})_` : ''}`)].join('\n')
    await atomicWrite(path.join(this.dir, 'memory.md'), md + '\n')
  }

  async addMemory(text: string, tags: string[], source: string): Promise<MemoryEntry> {
    const all = await this.listMemory()
    const entry: MemoryEntry = { id: shortId(), text: text.trim().slice(0, 1000), tags, source, createdAt: nowIso() }
    all.push(entry)
    await this.saveMemory(all)
    return entry
  }

  /**
   * Retrieve the most relevant memory entries for a prompt using keyword overlap
   * (no database / vector service). Always returns entries tagged "pinned".
   */
  async relevantMemory(prompt: string, limit = 12): Promise<MemoryEntry[]> {
    const all = await this.listMemory()
    return rankMemory(all, prompt, limit)
  }

  // ---------- runs / checkpoints ----------
  private runFile(id: string): string {
    return path.join(this.dir, 'runs', `${id}.json`)
  }

  async saveRun(run: RunState): Promise<void> {
    await this.ensure()
    run.updatedAt = nowIso()
    await writeJson(this.runFile(run.id), run)
  }

  async loadRun(id: string): Promise<RunState | null> {
    return readJson<RunState | null>(this.runFile(id), null)
  }

  async deleteRun(id: string): Promise<void> {
    await fs.rm(this.runFile(id), { force: true })
  }

  async listRuns(): Promise<RunSummary[]> {
    let files: string[] = []
    try {
      files = (await fs.readdir(path.join(this.dir, 'runs'))).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    const out: RunSummary[] = []
    for (const f of files) {
      const r = await readJson<RunState | null>(path.join(this.dir, 'runs', f), null)
      if (r) out.push({ id: r.id, project: r.project, objective: r.objective, status: r.status, updatedAt: r.updatedAt, mode: r.mode, changedFiles: r.changedFiles })
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** On startup: any run left "running"/"waiting_approval" was interrupted by a crash or exit. Never auto-resume. */
  async markInterrupted(): Promise<number> {
    let n = 0
    for (const s of await this.listRuns()) {
      if (s.status === 'running' || s.status === 'waiting_approval') {
        const r = await this.loadRun(s.id)
        if (r) {
          r.status = 'interrupted'
          await this.saveRun(r)
          n++
        }
      }
    }
    return n
  }
}

const STOP = new Set('the a an and or of to in on for with is are be this that it as at by from we you i our your use using'.split(' '))

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
}

export function rankMemory(all: MemoryEntry[], prompt: string, limit: number): MemoryEntry[] {
  const q = new Set(tokenize(prompt))
  const scored = all.map((e) => {
    const words = tokenize(e.text + ' ' + e.tags.join(' '))
    let score = 0
    for (const w of words) if (q.has(w)) score += 1
    if (e.tags.includes('pinned')) score += 100
    if (e.tags.includes('convention') || e.tags.includes('architecture')) score += 0.5
    return { e, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.e)
}
