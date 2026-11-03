import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { git, gitCommit } from '../src/main/git'
import { execTool, type ExecCtx } from '../src/main/agent/toolExec'
import { toolsFor } from '../src/main/agent/tools'
import { parseQuestions } from '../src/main/agent/askUser'
import { parseGithubRepo } from '../src/main/github'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { PendingApproval, Settings } from '../src/shared/types'

vi.setConfig({ testTimeout: 120_000 })

type Ask = Omit<PendingApproval, 'id' | 'runId' | 'project'>
let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-gt-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 })
})

function ctx(o: { mode?: string; agentId?: string; settings?: Partial<Settings>; answer?: (x: Ask) => { approved: boolean; feedback?: string } } = {}) {
  const asked: Ask[] = []
  const c = {
    run: { project: dir, mode: o.mode ?? 'build', commandsRun: [] },
    deps: { getSettings: async () => ({ ...DEFAULT_SETTINGS, ...o.settings }), secrets: async () => [] },
    agentId: o.agentId ?? 'lead', agentName: 'Dahl',
    turn: { changed: new Set(), commands: [], memories: 0 },
    approve: async (x: Ask) => (asked.push(x), o.answer ? o.answer(x) : { approved: true }),
    onChanged: () => {}, status: () => {}
  } as unknown as ExecCtx
  return { c, asked, run: (name: string, args: unknown) => execTool(c, name, JSON.stringify(args), [name]) }
}

async function repo(): Promise<void> {
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.email', 't@example.com'])
  await git(dir, ['config', 'user.name', 'Test'])
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\n')
  await gitCommit(dir, 'first', 'all')
}

describe('ask_user', () => {
  it('keeps 1 to 4 well-formed questions with 2 to 5 options', () => {
    const qs = parseQuestions([
      { question: 'Which database?', header: 'Database', options: [{ label: 'SQLite (Recommended)', description: 'One file' }, { label: 'Postgres' }] },
      { question: 'Only one option', options: ['a'] },
      { question: 'Features?', multiSelect: true, options: ['Auth', 'Billing', 'Search', 'Chat', 'Files', 'Extra'] }
    ])
    expect(qs).toHaveLength(2)
    expect(qs[0]).toMatchObject({ header: 'Database', multiSelect: false, options: [{ label: 'SQLite (Recommended)', description: 'One file' }, { label: 'Postgres' }] })
    expect(qs[1].options).toHaveLength(5)
  })

  it('asks the user and returns the answers to the model; skipping says so', async () => {
    const t = ctx({ answer: () => ({ approved: true, feedback: JSON.stringify({ 0: 'Postgres' }) }) })
    const r = await t.run('ask_user', { questions: [{ question: 'Which database?', options: ['SQLite', 'Postgres'] }] })
    expect(t.asked[0]).toMatchObject({ kind: 'question', questions: [{ question: 'Which database?' }] })
    expect(r.text).toMatch(/Which database\?\n\s+Answer: Postgres/)
    const s = await ctx({ answer: () => ({ approved: false }) }).run('ask_user', { questions: [{ question: 'Q?', options: ['a', 'b'] }] })
    expect(s.text).toMatch(/skipped/)
  })

  it('is offered to the lead in every mode, never to sub-agents', () => {
    for (const m of ['plan', 'review', 'build'] as const) expect(toolsFor('lead', m, false)).toContain('ask_user')
    expect(toolsFor('implementer', 'build', false)).not.toContain('ask_user')
  })
})

describe('git tool', () => {
  it('reads status, log and diff without asking', async () => {
    await repo()
    await fs.writeFile(path.join(dir, 'a.txt'), 'two\n')
    const t = ctx({ mode: 'review' })
    expect((await t.run('git', { action: 'status' })).text).toMatch(/Branch main[\s\S]*M a\.txt/)
    expect((await t.run('git', { action: 'log' })).text).toMatch(/first/)
    expect((await t.run('git', { action: 'diff' })).text).toMatch(/-one\n\+two/)
    expect(t.asked).toHaveLength(0)
  })

  it('refuses changes outside Build mode and for sub-agents', async () => {
    await repo()
    expect((await ctx({ mode: 'plan' }).run('git', { action: 'create_branch', name: 'x' })).text).toMatch(/only runs in Build mode/)
    expect((await ctx({ agentId: 'implementer-1' }).run('git', { action: 'commit', message: 'm' })).text).toMatch(/Only the lead/)
    expect((await ctx().run('git', { action: 'create_branch', name: '-rf' })).text).toMatch(/Invalid branch/)
  })

  it('branches, commits and merges with approval, and reports conflicts', async () => {
    await repo()
    const t = ctx()
    expect((await t.run('git', { action: 'create_branch', name: 'feature' })).ok).toBe(true)
    await fs.writeFile(path.join(dir, 'a.txt'), 'feature\n')
    expect((await t.run('git', { action: 'commit', message: 'feature change' })).ok).toBe(true)
    expect((await t.run('git', { action: 'switch', ref: 'main' })).ok).toBe(true)
    await fs.writeFile(path.join(dir, 'a.txt'), 'main\n')
    await t.run('git', { action: 'commit', message: 'main change' })
    const m = await t.run('git', { action: 'merge', ref: 'feature' })
    expect(m.ok).toBe(false)
    expect(m.text).toMatch(/conflicts in: a\.txt/)
    expect((await t.run('git', { action: 'status' })).text).toMatch(/Unresolved conflicts: a\.txt/)
    expect((await t.run('git', { action: 'merge_abort' })).ok).toBe(true)
    expect(t.asked.map((a) => a.command)).toEqual(['git switch -c feature', 'git add -A; git commit -m "feature change"', 'git switch main', 'git add -A; git commit -m "main change"', 'git merge --no-edit feature', 'git merge --abort'])
  })

  it('does nothing when the user declines', async () => {
    await repo()
    const r = await ctx({ answer: () => ({ approved: false, feedback: 'not yet' }) }).run('git', { action: 'tag', name: 'v1' })
    expect(r.text).toMatch(/declined.*not yet/)
    expect((await git(dir, ['tag'])).out.trim()).toBe('')
  })
})

describe('github tool', () => {
  it('reads owner and repo from origin URLs', () => {
    expect(parseGithubRepo('https://github.com/Nexkeys/dahl-studio.git')).toEqual({ owner: 'Nexkeys', repo: 'dahl-studio' })
    expect(parseGithubRepo('git@github.com:o/r.git')).toEqual({ owner: 'o', repo: 'r' })
    expect(parseGithubRepo('https://gitlab.com/o/r')).toBeNull()
  })

  it('explains what is missing before calling GitHub', async () => {
    await repo()
    expect((await ctx().run('github', { action: 'list_prs' })).text).toMatch(/No origin remote/)
    expect((await ctx({ mode: 'review' }).run('github', { action: 'create_pr', title: 't' })).text).toMatch(/only runs in Build mode/)
  })
})
