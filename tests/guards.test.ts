import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claimedFiles, evidenceNote, findClaims, missingClaimedFiles, unsupportedClaims } from '../src/main/agent/guards'
import { AgentRunner, type ChatBackend } from '../src/main/agent/runner'
import { toolsFor } from '../src/main/agent/tools'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { AgentEvent, ChatMessage } from '../src/shared/types'

describe('claims in a reply', () => {
  const kinds = (t: string) => findClaims(t).map((c) => c.kind)

  it('finds plain statements that a check succeeded', () => {
    expect(kinds('All tests pass.')).toEqual(['test'])
    expect(kinds('I fixed the parser. The tests are now passing and the build succeeds.')).toEqual(['test', 'build'])
    expect(kinds('It compiles without errors and lint is clean.')).toEqual(['build', 'check'])
    expect(kinds('There are no type errors.')).toEqual(['check'])
    expect(kinds('Typecheck passes.')).toEqual(['check'])
  })

  it('ignores conditions, plans, negations and honest mixed reports', () => {
    expect(kinds('Once the tests pass, we can merge.')).toEqual([])
    expect(kinds('Run npm test to check whether the tests pass.')).toEqual([])
    expect(kinds('I could not confirm that the build succeeds.')).toEqual([])
    expect(kinds("I haven't run them, so the tests pass is unverified.")).toEqual([])
    expect(kinds('Please make sure the tests pass before you merge.')).toEqual([])
    expect(kinds('3 tests passed, 2 failed.')).toEqual([])
    expect(kinds('4 of 6 tests passed.')).toEqual([])
    expect(kinds('I am getting the tests passing next.')).toEqual([])
  })

  it('ignores code blocks and inline code: that is output, not a statement', () => {
    expect(kinds('Output:\n```\nAll tests passed\n```\nSee above.')).toEqual([])
    expect(kinds('The script prints `tests passed` at the end.')).toEqual([])
  })
})

describe('claims need evidence', () => {
  it('a claim with no command of that kind is unsupported', () => {
    const u = unsupportedClaims('All tests pass.', [{ command: 'npm run build', exitCode: 0 }])
    expect(u).toMatchObject([{ kind: 'test', why: 'not_run' }])
  })

  it('a claim whose last command failed is unsupported; a later passing run supports it', () => {
    expect(unsupportedClaims('The tests pass.', [{ command: 'npx vitest run', exitCode: 1 }])).toMatchObject([{ kind: 'test', why: 'failed', exitCode: 1 }])
    expect(unsupportedClaims('The tests pass.', [{ command: 'npx vitest run', exitCode: 1 }, { command: 'npx vitest run', exitCode: 0 }])).toEqual([])
    expect(unsupportedClaims('The tests pass.', [{ command: 'npm test', exitCode: 0 }, { command: 'npm test', exitCode: 2 }])).toMatchObject([{ why: 'failed' }])
  })

  it('each kind needs its own command', () => {
    const cmds = [{ command: 'npm test', exitCode: 0 }, { command: 'npm run typecheck', exitCode: 0 }]
    expect(unsupportedClaims('Tests pass and there are no type errors.', cmds)).toEqual([])
    expect(unsupportedClaims('Tests pass and the build succeeds.', [{ command: 'npm test', exitCode: 0 }])).toMatchObject([{ kind: 'build', why: 'not_run' }])
  })

  it('a reply without claims is never flagged', () => {
    expect(unsupportedClaims('I changed the greeting in a.txt.', [])).toEqual([])
  })

  it('the note for the user names the claim and the reason', () => {
    const note = evidenceNote(unsupportedClaims('All tests pass.', []), ['src/gone.ts'])
    expect(note).toContain('Not verified by Dahl Studio')
    expect(note).toContain('no test command ran in this task')
    expect(note).toContain('src/gone.ts')
  })
})

describe('files a reply says it created', () => {
  it('reads backticked paths after created, wrote, saved or generated', () => {
    expect(claimedFiles('I created `src/app.ts` and `README.md`.')).toEqual(['src/app.ts', 'README.md'])
    expect(claimedFiles('Wrote `./docs/plan.md` with the steps.')).toEqual(['docs/plan.md'])
  })

  it('does not take ordinary words, URLs, calls or code blocks for files', () => {
    expect(claimedFiles('I created a helper called `formatDate` and a config object.')).toEqual([])
    expect(claimedFiles('I created `https://example.com/a.html` as a link.')).toEqual([])
    expect(claimedFiles('I created `init()` in the module.')).toEqual([])
    expect(claimedFiles('Created:\n```\nsrc/x.ts\n```')).toEqual([])
    expect(claimedFiles('The file `src/old.ts` is unchanged.')).toEqual([])
  })

  it('reports only the claimed files that are not there', async () => {
    const present = new Set(['src/app.ts'])
    const missing = await missingClaimedFiles('I created `src/app.ts`, `src/ghost.ts` and `Button.tsx`.', ['src/components/Button.tsx'], async (rel) => present.has(rel))
    expect(missing).toEqual(['src/ghost.ts'])
  })
})

describe('guards in a running task', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-guard-'))
    await fs.writeFile(path.join(dir, 'a.txt'), 'hello world\n')
  })
  afterEach(async () => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }))

  type Step = { content?: string; tool?: { name: string; args: unknown } }
  function run(steps: Step[], opts: { exitCode?: number; onCommand?: () => Promise<void> } = {}) {
    const sent: ChatMessage[][] = []
    const events: AgentEvent[] = []
    const backend: ChatBackend = {
      async chat(req) {
        sent.push(req.messages)
        const r = steps.shift() ?? { content: 'done' }
        return { content: r.content ?? '', reasoning: '', toolCalls: r.tool ? [{ id: `c${sent.length}`, type: 'function' as const, function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }] : [] }
      }
    }
    const runner = new AgentRunner({
      backend,
      getSettings: async () => ({ ...DEFAULT_SETTINGS, autoApproveAll: true }),
      emit: (e) => events.push(e),
      runCommand: async () => {
        await opts.onCommand?.()
        return { exitCode: opts.exitCode ?? 0, output: 'ok', timedOut: false }
      },
      secrets: async () => []
    })
    const finish = async () => {
      await runner.start({ project: dir, prompt: 'do it', mode: 'build', model: 'm' })
      while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    }
    const tools = () => events.filter((e) => e.type === 'transcript' && e.item?.kind === 'tool').map((e) => e.item!.tool!)
    const notes = () => events.filter((e) => e.type === 'transcript' && e.item?.kind === 'status').map((e) => e.item!.text ?? '')
    const labels = () => events.filter((e) => e.type === 'transcript' && e.item?.kind === 'tool').map((e) => e.item!.text ?? '')
    const lastUser = (i: number) => String(sent[i].filter((m) => m.role === 'user').pop()!.content)
    return { sent, finish, tools, notes, labels, lastUser }
  }
  const read = { tool: { name: 'read_file', args: { path: 'a.txt' } } }
  const edit = { tool: { name: 'edit_file', args: { path: 'a.txt', old_string: 'world', new_string: 'Dahl' } } }
  const text = () => fs.readFile(path.join(dir, 'a.txt'), 'utf8')

  it('refuses to edit an existing file the agent has not read, and allows it after a read', async () => {
    const h = run([edit, read, edit, { content: 'Changed the greeting in a.txt.' }])
    await h.finish()
    const t = h.tools()
    expect(t[0].ok).toBe(false)
    expect(t[0].result).toContain('have not read it in this task')
    expect(t[2].ok).toBe(true)
    expect(await text()).toBe('hello Dahl\n')
  })

  it('refuses to overwrite an unread file but lets a new file be created and then changed', async () => {
    const h = run([
      { tool: { name: 'write_file', args: { path: 'a.txt', content: 'gone' } } },
      { tool: { name: 'write_file', args: { path: 'b.txt', content: 'one\n' } } },
      { tool: { name: 'append_file', args: { path: 'b.txt', content: 'two\n' } } },
      { content: 'Made b.txt.' }
    ])
    await h.finish()
    const t = h.tools()
    expect(t[0].ok).toBe(false)
    expect(await text()).toBe('hello world\n')
    expect(t[1].ok).toBe(true)
    expect(t[2].ok).toBe(true)
    expect(await fs.readFile(path.join(dir, 'b.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('asks for a new read when the file changed on disk after the agent read it', async () => {
    const h = run([read, { tool: { name: 'run_command', args: { command: 'format' } } }, edit, { content: 'Stopped.' }], {
      onCommand: async () => {
        await fs.writeFile(path.join(dir, 'a.txt'), 'hello big world\n')
        // make sure the modification time differs even on a coarse clock
        const later = new Date(Date.now() + 5000)
        await fs.utimes(path.join(dir, 'a.txt'), later, later)
      }
    })
    await h.finish()
    const t = h.tools()
    expect(t[2].ok).toBe(false)
    expect(t[2].result).toContain('changed on disk after you last read it')
    expect(await text()).toBe('hello big world\n')
  })

  it('asks once for evidence when the reply says tests pass and no test ran, and accepts a corrected reply', async () => {
    const h = run([{ content: 'Done. All tests pass.' }, { content: 'Correction: I did not run the tests, so they are not verified.' }])
    await h.finish()
    expect(h.sent.length).toBe(2)
    expect(h.lastUser(1)).toContain('no test command ran in this task')
    expect(h.notes().some((n) => n.startsWith('Not verified by Dahl Studio'))).toBe(false)
  })

  it('accepts the claim after the model really runs the tests', async () => {
    const h = run([{ content: 'All tests pass.' }, { tool: { name: 'run_command', args: { command: 'npm test' } } }, { content: 'I ran npm test. All tests pass.' }])
    await h.finish()
    expect(h.sent.length).toBe(3)
    expect(h.notes().some((n) => n.startsWith('Not verified by Dahl Studio'))).toBe(false)
  })

  it('tells the user when the claim is repeated without evidence', async () => {
    const h = run([{ content: 'All tests pass.' }, { content: 'Yes, all tests pass.' }])
    await h.finish()
    expect(h.sent.length).toBe(2)
    expect(h.notes().filter((n) => n.startsWith('Not verified by Dahl Studio')).join(' ')).toContain('no test command ran in this task')
  })

  it('does not accept "tests pass" after a failing test run', async () => {
    const h = run([{ tool: { name: 'run_command', args: { command: 'npm test' } } }, { content: 'The tests pass.' }, { content: 'The tests pass.' }], { exitCode: 1 })
    await h.finish()
    expect(h.lastUser(2)).toContain('exit code 1')
    expect(h.notes().some((n) => n.includes('exit code 1'))).toBe(true)
  })

  it('catches a file that the reply says was created but does not exist', async () => {
    const h = run([{ content: 'I created `src/ghost.ts` with the helper.' }, { content: 'Correction: nothing was written yet.' }])
    await h.finish()
    expect(h.lastUser(1)).toContain('`src/ghost.ts`')
  })

  it('offers report_blocked in every mode and records the blocker', async () => {
    for (const mode of ['build', 'plan', 'review'] as const) expect(toolsFor('lead', mode, false)).toContain('report_blocked')
    const h = run([{ tool: { name: 'report_blocked', args: { reason: 'The API key for the payment service is missing.', needs: 'The key' } } }, { content: 'I am blocked: the payment API key is missing. Please add it.' }])
    await h.finish()
    const t = h.tools()
    expect(t[0].ok).toBe(true)
    expect(t[0].result).toContain('Do not invent a result')
    expect(h.labels().join(' ')).toContain('Blocked: The API key')
  })
})
