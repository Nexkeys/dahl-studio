import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ChiefStore, parseDue, dayOf } from '../src/main/chief/store'
import { gatherBriefing, formatBriefing, parseNextSteps } from '../src/main/chief/briefing'
import { resolveProject } from '../src/main/chief/tools'
import { ProjectStore } from '../src/main/store/projectStore'
import type { PendingApproval, RunState } from '../src/shared/types'

let dir: string
let projA: string
let projB: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-chief-'))
  projA = path.join(dir, 'Alpha')
  projB = path.join(dir, 'Beta')
  await fs.mkdir(projA, { recursive: true })
  await fs.mkdir(projB, { recursive: true })
})
afterEach(async () => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }))

function run(project: string, over: Partial<RunState>): RunState {
  return {
    id: over.id ?? 'r1', project, objective: over.objective ?? 'task', mode: 'build', model: 'm', thinking: 'off',
    status: over.status ?? 'completed', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: over.updatedAt ?? new Date().toISOString(),
    plan: over.plan ?? [], changedFiles: over.changedFiles ?? [], commandsRun: [], backups: {}, messages: [], transcript: [], iterations: 0,
    lastError: over.lastError, agents: [], log: []
  }
}

describe('ChiefStore follow-ups and goals', () => {
  it('adds, lists and completes follow-ups, open ones sorted by due date', async () => {
    const s = new ChiefStore(dir)
    await s.addFollowup('ship installer', { due: '2026-12-01' })
    const soon = await s.addFollowup('reply to vendor', { due: 'today', project: projB })
    await s.addFollowup('someday idea')
    const open = await s.listFollowups()
    expect(open.map((f) => f.text)).toEqual(['reply to vendor', 'ship installer', 'someday idea'])
    expect(open[open.length - 1].due).toBeNull()
    await s.completeFollowup(soon.id)
    expect((await s.listFollowups()).some((f) => f.id === soon.id)).toBe(false)
    expect((await s.listFollowups({ withDone: true })).find((f) => f.id === soon.id)?.doneAt).toBeTruthy()
  })

  it('rejects an unreadable due date and empty text', async () => {
    const s = new ChiefStore(dir)
    await expect(s.addFollowup('x', { due: 'whenever' })).rejects.toThrow()
    await expect(s.addFollowup('   ')).rejects.toThrow()
  })

  it('reads and writes goals.md', async () => {
    const s = new ChiefStore(dir)
    expect(await s.goals()).toBeNull()
    await s.setGoals('# Goals\n- ship 0.4.0')
    expect(await s.goals()).toContain('ship 0.4.0')
    await expect(s.setGoals('   ')).rejects.toThrow()
  })

  it('parses relative due dates', () => {
    const now = new Date(2026, 10, 8)
    expect(parseDue('today', now)).toBe('2026-11-08')
    expect(parseDue('tomorrow', now)).toBe('2026-11-09')
    expect(parseDue('in 3 days', now)).toBe('2026-11-11')
    expect(parseDue('next week', now)).toBe('2026-11-15')
    expect(parseDue('2026-12-25', now)).toBe('2026-12-25')
    expect(parseDue('banana', now)).toBeNull()
  })
})

describe('parseNextSteps', () => {
  it('reads a "Next steps" heading list', () => {
    const doc = '# Progress\n\n## Next steps (suggested order)\n1. Live-test OpenAI\n2. Add a Pull button\n\n## Other\n- ignore me'
    expect(parseNextSteps(doc)).toEqual(['Live-test OpenAI', 'Add a Pull button'])
  })
  it('falls back to the newest **Next steps:** block, then to open plan steps', () => {
    expect(parseNextSteps('log\n\n**Next steps:**\n- finish the card\n- write tests\n')).toEqual(['finish the card', 'write tests'])
    const plan = '<!-- dahl:plan -->\n## Plan\n- [x] done one\n- [~] doing two\n- [ ] todo three\n<!-- /dahl:plan -->'
    expect(parseNextSteps(plan)).toEqual(['doing two', 'todo three'])
  })
})

describe('gatherBriefing', () => {
  const noGit = async () => ({ repo: false, branch: null, ahead: 0, behind: 0, files: [], remote: null, hasCommits: false, upstream: null, unpushed: 0 })

  it('aggregates needs-you, done-since and next steps across projects', async () => {
    const store = new ChiefStore(dir)
    await store.markBriefed('2026-11-07T00:00:00.000Z')
    await new ProjectStore(projA).saveRun(run(projA, { id: 'a-fail', status: 'failed', objective: 'build app', lastError: 'No Dahl API key\nsecond line', updatedAt: new Date().toISOString() }))
    await new ProjectStore(projA).saveRun(run(projA, { id: 'a-done', status: 'completed', objective: 'add tests', changedFiles: ['a.ts'], updatedAt: new Date().toISOString() }))
    await fs.writeFile(path.join(projB, 'PROGRESS.md'), '# Progress\n\n## Next steps\n- wire up the API\n- ship it\n')
    await store.addFollowup('call the bank', { due: '2020-01-01' }) // overdue
    const approvals: PendingApproval[] = [{ id: 'ap1', runId: 'x', project: projA, kind: 'command', command: 'npm test' }]

    const data = await gatherBriefing({ projects: [projA, projB], store, approvals, activeRuns: [], git: noGit })
    const pa = data.projects.find((p) => p.name === 'Alpha')!
    expect(pa.needsYou.find((r) => r.id === 'a-fail')?.error).toBe('No Dahl API key')
    expect(pa.doneSince.map((r) => r.id)).toContain('a-done')
    expect(pa.approvals).toHaveLength(1)
    expect(data.projects.find((p) => p.name === 'Beta')!.nextSteps).toEqual(['wire up the API', 'ship it'])
    expect(data.overdue.map((f) => f.text)).toEqual(['call the bank'])

    const text = formatBriefing(data)
    expect(text).toContain('NEEDS THE USER')
    expect(text).toContain('call the bank')
    expect(text).toContain('npm test')
    expect(text).toContain('AGENT WORK SINCE LAST BRIEFING')
    expect(text).toContain('wire up the API')
  })

  it('excludes work finished before the last briefing from done-since', async () => {
    const store = new ChiefStore(dir)
    await store.markBriefed(new Date().toISOString())
    // write the run file directly: saveRun always stamps updatedAt=now, which would defeat the "old" date
    await new ProjectStore(projA).ensure()
    await fs.writeFile(path.join(projA, '.dahl', 'runs', 'old.json'), JSON.stringify(run(projA, { id: 'old', status: 'completed', updatedAt: '2026-11-01T00:00:00.000Z' })))
    const data = await gatherBriefing({ projects: [projA], store, approvals: [], activeRuns: [], git: noGit })
    expect(data.projects[0].doneSince).toHaveLength(0)
  })
})

describe('resolveProject', () => {
  it('matches by folder name, full path and "current"', () => {
    const open = [projA, projB]
    expect(resolveProject('Beta', open, projA)).toBe(projB)
    expect(resolveProject('current', open, projA)).toBe(projA)
    expect(resolveProject(projB, open, projA)).toBe(projB)
    expect(resolveProject('Gamma', open, projA)).toBeNull()
  })
})
