import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { ChiefFollowup, PendingApproval, RunSummary } from '@shared/types'
import { ProjectStore } from '../store/projectStore'
import { gitStatus, type GitStatus } from '../git'
import { dayOf, type ChiefStore } from './store'

// The Chief of Staff briefing: everything Dahl can see locally across the open projects, gathered in one call so the
// model can turn it into a briefing the user scans in under 30 seconds. Read-only except for the "last briefing" stamp.

const NEEDS_YOU: RunSummary['status'][] = ['waiting_approval', 'paused', 'failed', 'interrupted']
const RECENT_DAYS = 14

export interface ProjectBrief {
  root: string
  name: string
  running: RunSummary[]
  needsYou: (RunSummary & { error?: string })[]
  doneSince: RunSummary[]
  nextSteps: string[]
  git: Pick<GitStatus, 'repo' | 'branch' | 'ahead' | 'behind' | 'unpushed' | 'remote'> & { changed: number } | null
  approvals: PendingApproval[]
}

export interface BriefingData {
  at: Date
  since: string
  goals: string | null
  projects: ProjectBrief[]
  overdue: ChiefFollowup[]
  dueToday: ChiefFollowup[]
  upcoming: ChiefFollowup[]
}

export interface BriefingDeps {
  projects: string[]
  store: ChiefStore
  approvals: PendingApproval[]
  activeRuns: { project: string; runId: string }[]
  now?: Date
  git?: (root: string) => Promise<GitStatus>
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s)
const items = (lines: string[]): string[] => lines.map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ x~!]\]\s+)?(.+)$/.exec(l)?.[1]?.trim() ?? '').filter(Boolean)

/** "Next steps" from a PROGRESS.md: a Next steps heading, else the newest "**Next steps:**" block, else open plan steps. */
export function parseNextSteps(doc: string, max = 5): string[] {
  const lines = doc.split(/\r?\n/)
  const h = lines.findIndex((l) => /^#{1,6}\s+next steps\b/i.test(l))
  let found: string[] = []
  if (h >= 0) {
    const level = /^#+/.exec(lines[h])![0].length
    const end = lines.findIndex((l, i) => i > h && new RegExp(`^#{1,${level}}\\s`).test(l))
    found = items(lines.slice(h + 1, end < 0 ? undefined : end))
  }
  if (!found.length) {
    const last = doc.lastIndexOf('**Next steps:**')
    if (last >= 0) found = items(doc.slice(last).split(/\r?\n/).slice(1).join('\n').split(/\n\s*\n/)[0].split('\n'))
  }
  if (!found.length) {
    const plan = /<!-- dahl:plan -->([\s\S]*?)<!-- \/dahl:plan -->/.exec(doc)?.[1] ?? ''
    found = items(plan.split(/\r?\n/).filter((l) => /\[[ ~]\]/.test(l)))
  }
  return found.slice(0, max).map((s) => clip(s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), 200))
}

async function projectBrief(root: string, d: BriefingDeps, since: string, now: Date): Promise<ProjectBrief> {
  const store = new ProjectStore(root)
  const runs = await store.listRuns()
  const recent = new Date(now.getTime() - RECENT_DAYS * 86400000).toISOString()
  const active = new Set(d.activeRuns.filter((a) => path.resolve(a.project).toLowerCase() === path.resolve(root).toLowerCase()).map((a) => a.runId))
  const running = runs.filter((r) => active.has(r.id) || (r.status === 'running' && r.updatedAt >= recent))
  const needsYou: ProjectBrief['needsYou'] = []
  for (const r of runs.filter((x) => !running.includes(x) && NEEDS_YOU.includes(x.status) && x.updatedAt >= recent).slice(0, 5)) {
    const full = r.status === 'failed' ? await store.loadRun(r.id).catch(() => null) : null
    needsYou.push({ ...r, error: full?.lastError ? clip(full.lastError.split('\n')[0], 200) : undefined })
  }
  const doneSince = runs.filter((r) => r.updatedAt > since && (r.status === 'completed' || r.status === 'cancelled') && !running.includes(r)).slice(0, 8)
  const doc = await fs.readFile(path.join(root, 'PROGRESS.md'), 'utf8').catch(() => '')
  const g = await (d.git ?? gitStatus)(root).catch(() => null)
  return {
    root, name: path.basename(root), running, needsYou, doneSince, nextSteps: doc ? parseNextSteps(doc) : [],
    git: g?.repo ? { repo: true, branch: g.branch, ahead: g.ahead, behind: g.behind, unpushed: g.unpushed, remote: g.remote, changed: g.files.length } : null,
    approvals: d.approvals.filter((a) => path.resolve(a.project).toLowerCase() === path.resolve(root).toLowerCase())
  }
}

export async function gatherBriefing(d: BriefingDeps): Promise<BriefingData> {
  const now = d.now ?? new Date()
  const since = (await d.store.lastBriefing()) ?? new Date(now.getTime() - 86400000).toISOString()
  const today = dayOf(now)
  const week = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))
  const open = await d.store.listFollowups()
  return {
    at: now, since, goals: await d.store.goals(),
    projects: await Promise.all(d.projects.map((p) => projectBrief(p, d, since, now))),
    overdue: open.filter((f) => f.due && f.due < today),
    dueToday: open.filter((f) => f.due === today),
    upcoming: open.filter((f) => (f.due && f.due > today && f.due <= week) || !f.due).slice(0, 10)
  }
}

const fu = (f: ChiefFollowup): string => `${f.text} [id ${f.id}]${f.project ? ` (${path.basename(f.project)})` : ''}`
const when = (iso: string): string => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

/** Plain text for the model: complete facts, grouped so it can lead with priorities and what needs the user. */
export function formatBriefing(b: BriefingData): string {
  const out: string[] = [`CHIEF OF STAFF DATA (${when(b.at.toISOString())}, local time; agent work since ${when(b.since)}). Condense this for the user; do not paste it.`]
  out.push('', 'GOALS (goals.md):', b.goals ? clip(b.goals.trim(), 2500) : '(no goals.md yet: ask the user for this week\'s top 3 priorities and save them with chief_goals)')
  const needs: string[] = []
  for (const p of b.projects) {
    if (p.approvals.length) needs.push(`- [${p.name}] ${p.approvals.length} approval(s) waiting: ${p.approvals.map((a) => a.kind === 'write' ? `change ${a.path}` : a.kind === 'command' ? `run ${clip(a.command ?? '', 80)}` : a.kind === 'question' ? `answer "${clip(a.questions?.[0]?.question ?? '', 80)}"` : `${a.kind} ${a.tool ?? ''}`.trim()).join('; ')}`)
    for (const r of p.needsYou) needs.push(`- [${p.name}] task "${clip(r.objective, 90)}" is ${r.status.replace('_', ' ')} (${when(r.updatedAt)})${r.error ? `: ${r.error}` : ''}`)
  }
  for (const f of b.overdue) needs.push(`- Follow-up OVERDUE (due ${f.due}): ${fu(f)}`)
  for (const f of b.dueToday) needs.push(`- Follow-up due today: ${fu(f)}`)
  out.push('', 'NEEDS THE USER:', ...(needs.length ? needs : ['(nothing waiting)']))
  const done = b.projects.flatMap((p) => p.doneSince.map((r) => `- [${p.name}] ${r.status}: "${clip(r.objective, 100)}" (${r.changedFiles.length} files changed, ${when(r.updatedAt)})`))
  out.push('', 'AGENT WORK SINCE LAST BRIEFING:', ...(done.length ? done : ['(none)']))
  const running = b.projects.flatMap((p) => p.running.map((r) => `- [${p.name}] "${clip(r.objective, 100)}" (${r.status})`))
  if (running.length) out.push('', 'RUNNING NOW:', ...running)
  out.push('', 'PROJECTS:')
  for (const p of b.projects) {
    const g = p.git
    const git = g ? `branch ${g.branch ?? 'detached'}, ${g.changed} uncommitted file(s), ${g.unpushed} unpushed commit(s)${g.behind ? `, ${g.behind} behind` : ''}${g.remote ? '' : ', no remote'}` : 'not a git repository'
    out.push(`## ${p.name} (${p.root})`, `- Git: ${git}`, p.nextSteps.length ? `- Next steps (PROGRESS.md):\n${p.nextSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}` : '- Next steps: none recorded in PROGRESS.md')
  }
  if (!b.projects.length) out.push('(no projects open)')
  if (b.upcoming.length) out.push('', 'UPCOMING FOLLOW-UPS (next 7 days and undated):', ...b.upcoming.map((f) => `- ${f.due ?? 'no date'}: ${fu(f)}`))
  return out.join('\n')
}
