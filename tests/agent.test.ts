import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRunner, closeDanglingToolCalls, type ChatBackend } from '../src/main/agent/runner'
import { resolveInside, PathBoundaryError } from '../src/main/fs/workspace'
import { ProjectStore, rankMemory } from '../src/main/store/projectStore'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import { SecretVault } from '../src/main/secrets'
import { redact, readJson } from '../src/main/util'
import { childEnv } from '../src/main/terminal'
import type { AgentEvent, ChatMessage, PendingApproval, RunState, Settings } from '../src/shared/types'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-test-'))
  await fs.writeFile(path.join(dir, 'a.txt'), 'hello world\n')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('path boundary', () => {
  it('allows paths inside the project', async () => {
    expect(await resolveInside(dir, 'a.txt')).toBe(path.join(dir, 'a.txt'))
    expect(await resolveInside(dir, 'new/sub/file.ts')).toBe(path.join(dir, 'new', 'sub', 'file.ts'))
  })
  it('rejects traversal and absolute paths outside', async () => {
    await expect(resolveInside(dir, '../escape.txt')).rejects.toBeInstanceOf(PathBoundaryError)
    await expect(resolveInside(dir, 'sub/../../escape.txt')).rejects.toBeInstanceOf(PathBoundaryError)
    await expect(resolveInside(dir, os.homedir())).rejects.toBeInstanceOf(PathBoundaryError)
    await expect(resolveInside(dir, 'C:\\Windows\\System32\\drivers\\etc\\hosts')).rejects.toBeInstanceOf(PathBoundaryError)
  })
})

/** Scripted fake model: returns queued responses in order. */
function scripted(responses: Array<{ content?: string; tool?: { name: string; args: unknown } }>): ChatBackend & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = []
  return {
    seen,
    async chat(req) {
      seen.push(req.messages)
      const r = responses.shift() ?? { content: 'done' }
      return {
        content: r.content ?? '',
        reasoning: '',
        toolCalls: r.tool ? [{ id: `c${seen.length}`, type: 'function' as const, function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }] : []
      }
    }
  }
}

function harness(backend: ChatBackend, settings: Partial<Settings> = {}) {
  const events: AgentEvent[] = []
  const commands: string[] = []
  let onApproval: ((a: PendingApproval) => void) | null = null
  const runner = new AgentRunner({
    backend,
    getSettings: async () => ({ ...DEFAULT_SETTINGS, ...settings }),
    emit: (e) => {
      events.push(e)
      if (e.type === 'approval') onApproval?.(e.approval!)
    },
    runCommand: async (c) => {
      commands.push(c)
      return { exitCode: 0, output: 'tests passed', timedOut: false }
    },
    secrets: async () => ['dahl_supersecret']
  })
  const done = () =>
    new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (!runner.isActive(dir)) {
          clearInterval(t)
          resolve()
        }
      }, 5)
    })
  return { runner, events, commands, done, setApprover: (f: (a: PendingApproval) => void) => (onApproval = f) }
}

describe('agent approval flow', () => {
  it('does not write a file until the user approves, then applies it', async () => {
    const backend = scripted([{ tool: { name: 'edit_file', args: { path: 'a.txt', old_string: 'world', new_string: 'Dahl', reason: 'greet' } } }, { content: 'Changed a.txt' }])
    const h = harness(backend)
    let pending = null as PendingApproval | null
    h.setApprover((a) => (pending = a))
    await h.runner.start({ project: dir, prompt: 'change greeting', mode: 'build', model: 'm' })
    while (!pending) await new Promise((r) => setTimeout(r, 5))
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('hello world\n') // untouched while waiting
    expect(pending!.before).toBe('hello world\n')
    expect(pending!.after).toBe('hello Dahl\n')
    h.runner.resolveApproval(pending!.id, true)
    await h.done()
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('hello Dahl\n')
    const run = (await new ProjectStore(dir).loadRun(h.events[0].runId)) as RunState
    expect(run.status).toBe('completed')
    expect(run.changedFiles).toEqual(['a.txt'])
    const sum = run.transcript.find((t) => t.kind === 'summary')!.summary!
    expect(sum.changedFiles).toEqual(['a.txt'])
    expect(sum.revertable).toBe(true)
    // revert restores the original content
    await h.runner.revert(dir, run.id)
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('hello world\n')
  })

  it('leaves the file untouched when rejected and passes feedback to the model', async () => {
    const backend = scripted([{ tool: { name: 'write_file', args: { path: 'a.txt', content: 'gone', reason: 'x' } } }, { content: 'ok, leaving it' }])
    const h = harness(backend)
    h.setApprover((a) => h.runner.resolveApproval(a.id, false, 'keep it'))
    await h.runner.start({ project: dir, prompt: 'overwrite', mode: 'build', model: 'm' })
    await h.done()
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('hello world\n')
    const toolMsg = backend.seen[1].find((m) => m.role === 'tool')!
    expect(toolMsg.content).toContain('rejected')
    expect(toolMsg.content).toContain('keep it')
  })

  it('requires approval before running commands', async () => {
    const backend = scripted([{ tool: { name: 'run_command', args: { command: 'npm test', reason: 'verify' } } }, { content: 'tests pass' }])
    const h = harness(backend)
    const kinds: string[] = []
    h.setApprover((a) => {
      kinds.push(a.kind)
      h.runner.resolveApproval(a.id, true)
    })
    await h.runner.start({ project: dir, prompt: 'test', mode: 'build', model: 'm' })
    await h.done()
    expect(kinds).toEqual(['command'])
    expect(h.commands).toEqual(['npm test'])
  })

  it('blocks writes outside the project even when auto-approve is on', async () => {
    const backend = scripted([{ tool: { name: 'write_file', args: { path: '../evil.txt', content: 'x', reason: 'x' } } }, { content: 'end' }])
    const h = harness(backend, { autoApproveWrites: true })
    await h.runner.start({ project: dir, prompt: 'escape', mode: 'build', model: 'm' })
    await h.done()
    await expect(fs.access(path.join(dir, '..', 'evil.txt'))).rejects.toThrow()
    expect(backend.seen[1].find((m) => m.role === 'tool')!.content).toContain('outside the approved project folder')
  })

  it('denies write tools in plan mode', async () => {
    const backend = scripted([{ tool: { name: 'write_file', args: { path: 'a.txt', content: 'x', reason: 'x' } } }, { content: 'plan only' }])
    const h = harness(backend, { autoApproveWrites: true })
    await h.runner.start({ project: dir, prompt: 'plan', mode: 'plan', model: 'm' })
    await h.done()
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('hello world\n')
    expect(backend.seen[1].find((m) => m.role === 'tool')!.content).toContain('not available to this agent in plan mode')
  })

  it('refuses a second concurrent run in the same project but allows another project', async () => {
    const slow: ChatBackend = { chat: () => new Promise((r) => setTimeout(() => r({ content: 'x', reasoning: '', toolCalls: [] }), 60)) }
    const h = harness(slow)
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-test2-'))
    try {
      await h.runner.start({ project: dir, prompt: 'one', mode: 'plan', model: 'm' })
      await expect(h.runner.start({ project: dir, prompt: 'two', mode: 'plan', model: 'm' })).rejects.toThrow(/already running/)
      await h.runner.start({ project: other, prompt: 'three', mode: 'plan', model: 'm' })
      expect(h.runner.isActive(other)).toBe(true)
      await h.done()
    } finally {
      await new Promise((r) => setTimeout(r, 100))
      await fs.rm(other, { recursive: true, force: true })
    }
  })

  it('checkpoints, survives restart as interrupted and resumes with Continue', async () => {
    const backend = scripted([{ tool: { name: 'update_plan', args: { steps: [{ title: 'Step A', status: 'in_progress' }] } } }, { tool: { name: 'list_dir', args: { path: '' } } }])
    const h = harness(backend)
    // pause after the first step
    const summary = await h.runner.start({ project: dir, prompt: 'long task', mode: 'plan', model: 'm' })
    while (!h.events.some((e) => e.type === 'plan')) await new Promise((r) => setTimeout(r, 5))
    h.runner.pause(dir)
    await h.done()
    const store = new ProjectStore(dir)
    let run = (await store.loadRun(summary.id))!
    expect(['paused', 'completed']).toContain(run.status)
    // simulate crash mid-run
    run.status = 'running'
    await store.saveRun(run)
    expect(await store.markInterrupted()).toBe(1)
    expect((await store.loadRun(summary.id))!.status).toBe('interrupted')
    // resume
    const h2 = harness(scripted([{ content: 'resumed and finished' }]))
    await h2.runner.start({ project: dir, prompt: 'Continue', mode: 'plan', model: 'm', resumeRunId: summary.id })
    await h2.done()
    run = (await store.loadRun(summary.id))!
    expect(run.status).toBe('completed')
    expect(run.plan[0].title).toBe('Step A')
    expect(run.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['long task', 'Continue'])
  })

  it('redacts secrets from tool output before it reaches the model', async () => {
    await fs.writeFile(path.join(dir, '.env'), 'DAHL_API_KEY=dahl_supersecret\n')
    const backend = scripted([{ tool: { name: 'read_file', args: { path: '.env' } } }, { content: 'read' }])
    const h = harness(backend)
    await h.runner.start({ project: dir, prompt: 'read env', mode: 'plan', model: 'm' })
    await h.done()
    const toolMsg = backend.seen[1].find((m) => m.role === 'tool')!
    expect(toolMsg.content).not.toContain('supersecret')
    expect(toolMsg.content).toContain('[REDACTED]')
  })
})

describe('persistence helpers', () => {
  it('closes dangling tool calls left by an interruption', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'x' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'write_file', arguments: '{}' } }] }
    ]
    closeDanglingToolCalls(msgs)
    expect(msgs[2]).toMatchObject({ role: 'tool', tool_call_id: 't1' })
  })

  it('ranks relevant memory and always includes pinned entries', () => {
    const mk = (text: string, tags: string[] = []) => ({ id: text, text, tags, source: 'u', createdAt: '' })
    const r = rankMemory([mk('Tests run with vitest'), mk('Use tabs in Go files'), mk('Never touch legacy/', ['pinned'])], 'how do I run the tests', 5)
    expect(r.map((m) => m.text)).toEqual(['Never touch legacy/', 'Tests run with vitest'])
  })

  it('moves corrupted JSON aside instead of crashing', async () => {
    const f = path.join(dir, 'bad.json')
    await fs.writeFile(f, '{not json')
    expect(await readJson(f, { ok: true })).toEqual({ ok: true })
    expect((await fs.readdir(dir)).some((n) => n.startsWith('bad.json.corrupt'))).toBe(true)
  })

  it('stores keys encrypted and never in plain text', async () => {
    const enc = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s.split('').reverse().join('')), decryptString: (b: Buffer) => b.toString().split('').reverse().join('') }
    const v = new SecretVault(dir, enc)
    await v.set('primary', 'dahl_plaintextkey')
    const raw = await fs.readFile(path.join(dir, 'secrets', 'primary.bin'), 'utf8')
    expect(raw).not.toContain('dahl_plaintextkey')
    expect(await new SecretVault(dir, enc).get('primary')).toBe('dahl_plaintextkey')
    const noEnc = new SecretVault(dir, { ...enc, isEncryptionAvailable: () => false })
    await expect(noEnc.set('secondary', 'dahl_x')).rejects.toThrow(/refusing/)
  })

  it('redacts credential patterns', () => {
    expect(redact('key dahl_abcdef123456 and Bearer abc.def.ghi123')).toBe('key [REDACTED] and [REDACTED]')
  })

  it('strips Dahl key variables from child process environments', () => {
    process.env.DAHL_API_KEY = 'dahl_shouldnotleak'
    expect(childEnv().DAHL_API_KEY).toBeUndefined()
    delete process.env.DAHL_API_KEY
  })
})
