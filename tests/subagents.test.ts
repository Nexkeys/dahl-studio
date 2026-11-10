import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRunner, type ChatBackend } from '../src/main/agent/runner'
import { ProjectStore } from '../src/main/store/projectStore'
import { DahlError } from '../src/main/dahl/client'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { AgentEvent, AgentInfo, ChatMessage, PendingApproval, Settings, StartRunRequest } from '../src/shared/types'

/** Scripted multi-agent model: the lead and each sub-agent (keyed by its task) get their own script. */
type Reply = { content?: string; tool?: { name: string; args: unknown } }
type SubFn = (task: string, step: number, signal: AbortSignal, msgs: ChatMessage[]) => Promise<Reply> | Reply

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-sub-'))
  await fs.writeFile(path.join(dir, 'a.ts'), 'a\n')
  await fs.writeFile(path.join(dir, 'b.ts'), 'b\n')
})
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50))
  await fs.rm(dir, { recursive: true, force: true })
})

const call = (r: Reply, id: string) => ({ content: r.content ?? '', reasoning: '', toolCalls: r.tool ? [{ id, type: 'function' as const, function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }] : [] })

function setup(agents: unknown[], sub: SubFn, settings: Partial<Settings> = {}) {
  const events: AgentEvent[] = []
  const leadSeen: ChatMessage[][] = []
  const steps = new Map<string, number>()
  let onApproval: ((a: PendingApproval) => void) | null = null
  let n = 0
  const backend: ChatBackend = {
    async chat(req, signal) {
      n++
      const sys = String(req.messages[0].content)
      if (sys.includes('lead coding agent')) {
        leadSeen.push(req.messages)
        const delegated = req.messages.some((m) => m.role === 'tool')
        return call(delegated ? { content: 'lead done' } : { tool: { name: 'delegate_agents', args: { agents } } }, `lead${n}`)
      }
      const task = /YOUR TASK:\n(.*)/.exec(sys)![1]
      const step = (steps.get(task) ?? 0) + 1
      steps.set(task, step)
      return call(await sub(task, step, signal, req.messages), `${task}-${step}`)
    }
  }
  const runner = new AgentRunner({
    backend,
    getSettings: async () => ({ ...DEFAULT_SETTINGS, autoMemory: false, maintainProgress: false, ...settings }),
    emit: (e) => {
      events.push(e)
      if (e.type === 'approval') onApproval?.(e.approval!)
    },
    runCommand: async () => ({ exitCode: 0, output: 'ok', timedOut: false }),
    secrets: async () => []
  })
  const start = (req: Partial<StartRunRequest> = {}) => runner.start({ project: dir, prompt: 'go', mode: 'build', model: 'dahl:m', ...req })
  const done = async () => {
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
  }
  const finalAgents = () => {
    const m = new Map<string, AgentInfo>()
    for (const e of events) if (e.type === 'agent') m.set(e.agent!.id, e.agent!)
    return [...m.values()]
  }
  const report = () => String(leadSeen.at(-1)!.find((m) => m.role === 'tool')?.content ?? '')
  return { runner, events, leadSeen, start, done, finalAgents, report, setApprover: (f: (a: PendingApproval) => void) => (onApproval = f) }
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted')) // like fetch with an already-aborted signal
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))))
  })

describe('sub-agents (delegate_agents)', () => {
  it('runs sub-agents truly concurrently (model calls overlap)', async () => {
    let inflight = 0
    let peak = 0
    const h = setup([{ role: 'code_reviewer', task: 'r1' }, { role: 'security_reviewer', task: 'r2' }, { role: 'architect', task: 'r3' }], async (task, step) => {
      inflight++
      peak = Math.max(peak, inflight)
      await wait(80)
      inflight--
      return step === 1 ? { tool: { name: 'list_dir', args: { path: '' } } } : { content: `report ${task}` }
    }, {})
    await h.start({ mode: 'review' })
    await h.done()
    // all three sub-agents were inside a model call at the same moment (no wall-clock check: CI load varies)
    expect(peak).toBe(3)
    expect(h.finalAgents().map((a) => a.status)).toEqual(['done', 'done', 'done'])
    expect(h.report()).toContain('report r1')
    expect(h.report()).toContain('report r3')
  })

  it('one failing sub-agent does not stop the others and the lead gets a clear report', async () => {
    const h = setup([{ role: 'code_reviewer', task: 'ok' }, { role: 'security_reviewer', task: 'boom' }], async (task) => {
      if (task === 'boom') throw new Error('Service error (503): upstream down')
      await wait(30)
      return { content: 'no issues found' }
    })
    const s = await h.start({ mode: 'review' })
    await h.done()
    const run = (await new ProjectStore(dir).loadRun(s.id))!
    expect(run.status).toBe('completed')
    const st = Object.fromEntries(h.finalAgents().map((a) => [a.task, a.status]))
    expect(st).toEqual({ ok: 'done', boom: 'failed' })
    expect(h.report()).toContain('no issues found')
    expect(h.report()).toMatch(/Security Reviewer\nFAILED: Service error \(503\)/)
  })

  it('retries a sub-agent model call once after a dropped stream (live failure: "Network error: terminated")', async () => {
    let tries = 0
    const h = setup([{ role: 'security_reviewer', task: 'flaky' }], () => {
      if (++tries === 1) throw new DahlError('network', 'Network error: terminated')
      return { content: 'eval at app.js:13 is RCE' }
    })
    await h.start({ mode: 'review' })
    await h.done()
    expect(tries).toBe(2)
    expect(h.finalAgents()[0].status).toBe('done')
    expect(h.report()).toContain('RCE')
  })

  it('cancel mid-delegation stops every sub-agent, marks them cancelled and emits nothing afterwards', async () => {
    const h = setup([{ role: 'code_reviewer', task: 'x' }, { role: 'researcher', task: 'y' }], async (_t, _s, signal) => {
      await wait(60_000, signal)
      return { content: 'never' }
    })
    const s = await h.start({ mode: 'review' })
    while (h.finalAgents().length < 2) await new Promise((r) => setTimeout(r, 5))
    h.runner.cancel(dir)
    await h.done()
    expect((await new ProjectStore(dir).loadRun(s.id))!.status).toBe('cancelled')
    expect(h.finalAgents().map((a) => a.status)).toEqual(['cancelled', 'cancelled'])
    const last = h.events.map((e) => e.type === 'status' && e.status === 'cancelled').lastIndexOf(true)
    expect(h.events.slice(last + 1).filter((e) => e.type === 'agent' || e.type === 'transcript')).toEqual([])
  })

  it('pause stops sub-agents at their next step instead of running them to the end', async () => {
    let calls = 0
    const h = setup([{ role: 'code_reviewer', task: 'loop' }], async () => {
      calls++
      await wait(20)
      return { tool: { name: 'list_dir', args: { path: '' } } } // would loop until the step limit (40)
    })
    const s = await h.start({ mode: 'review' })
    while (calls < 2) await new Promise((r) => setTimeout(r, 5))
    h.runner.pause(dir)
    await h.done()
    expect(calls).toBeLessThan(6)
    expect((await new ProjectStore(dir).loadRun(s.id))!.status).toBe('paused')
    expect(h.finalAgents()[0].report).toContain('paused')
  })

  it('enforces file leases between write agents (path spelling does not matter) and releases them afterwards', async () => {
    const h = setup(
      [{ role: 'implementer', task: 'own-a', files: ['a.ts'] }, { role: 'implementer', task: 'own-b', files: ['b.ts'] }],
      async (task, step) => {
        if (task === 'own-b' && step === 1) return { tool: { name: 'write_file', args: { path: './A.ts', content: 'stolen' } } }
        if (task === 'own-a' && step === 1) return { tool: { name: 'read_file', args: { path: 'a.ts' } } }
        if (task === 'own-a' && step === 2) return { tool: { name: 'edit_file', args: { path: 'a.ts', old_string: 'a', new_string: 'A' } } }
        return { content: `${task} finished` }
      },
      { autoApproveWrites: true }
    )
    await h.start()
    await h.done()
    expect(await fs.readFile(path.join(dir, 'a.ts'), 'utf8')).toBe('A\n')
    const rep = h.report()
    expect(rep).toContain('own-a finished')
    const tool = h.events.find((e) => e.type === 'transcript' && e.item?.tool?.name === 'write_file')!.item!.tool!
    expect(tool.ok).toBe(false)
    expect(tool.result).toMatch(/owned by another agent \(implementer-/)
  })

  it('refuses to give one file to two write agents', async () => {
    const h = setup([{ role: 'implementer', task: 'i1', files: ['a.ts'] }, { role: 'debugger', task: 'i2', files: ['./A.ts'] }], () => ({ content: 'x' }))
    await h.start()
    await h.done()
    expect(h.finalAgents()).toEqual([])
    expect(h.report()).toContain('assigned to more than one write agent')
  })

  it('prevents nested delegation by sub-agents', async () => {
    const h = setup([{ role: 'architect', task: 'nest' }], (_t, step) =>
      step === 1 ? { tool: { name: 'delegate_agents', args: { agents: [{ role: 'researcher', task: 'deeper' }] } } } : { content: 'design' }
    )
    await h.start({ mode: 'plan' })
    await h.done()
    expect(h.finalAgents().map((a) => a.task)).toEqual(['nest'])
    const t = h.events.find((e) => e.type === 'transcript' && e.item?.tool?.name === 'delegate_agents' && e.item.tool.agent)!.item!.tool!
    expect(t.result).toContain('not available to this agent')
  })

  it('mode and role enforcement: no writes in Plan/Review, read-only roles cannot write in Build, no web unless toggled', async () => {
    for (const [mode, role, tool] of [['review', 'implementer', 'write_file'], ['plan', 'debugger', 'run_command'], ['build', 'architect', 'edit_file'], ['build', 'researcher', 'web_search']] as const) {
      const h = setup([{ role, task: `t-${mode}-${role}`, files: ['a.ts'] }], (_t, step) =>
        step === 1 ? { tool: { name: tool, args: { path: 'a.ts', content: 'x', old_string: 'a', new_string: 'x', command: 'echo hi', query: 'q' } } } : { content: 'ok' },
        { autoApproveWrites: true, autoApproveCommands: true }
      )
      await h.start({ mode })
      await h.done()
      const t = h.events.find((e) => e.type === 'transcript' && e.item?.tool?.name === tool)!.item!.tool!
      expect(t.ok, `${mode}/${role}/${tool}`).toBe(false)
      expect(t.result).toContain(`not available to this agent in ${mode} mode`)
    }
    expect(await fs.readFile(path.join(dir, 'a.ts'), 'utf8')).toBe('a\n')
  })

  it('attributes approvals to the sub-agent and clears "waiting" once approved', async () => {
    const h = setup([{ role: 'implementer', task: 'w', files: ['a.ts'] }], (_t, step) =>
      step === 1 ? { tool: { name: 'read_file', args: { path: 'a.ts' } } } : step === 2 ? { tool: { name: 'write_file', args: { path: 'a.ts', content: 'new' } } } : { content: 'wrote it' }
    )
    const seen: PendingApproval[] = []
    h.setApprover((a) => {
      seen.push(a)
      setTimeout(() => h.runner.resolveApproval(a.id, true), 10)
    })
    await h.start()
    await h.done()
    expect(seen.map((a) => [a.kind, a.agent])).toEqual([['write', 'Implementer']])
    const statuses = h.events.filter((e) => e.type === 'agent').map((e) => e.agent!.status)
    const w = statuses.indexOf('waiting_approval')
    expect(w).toBeGreaterThan(-1)
    expect(statuses[w + 1]).toBe('tool')
    expect(await fs.readFile(path.join(dir, 'a.ts'), 'utf8')).toBe('new')
  })

  it('caps one delegation at 6 sub-agents', async () => {
    const h = setup(Array.from({ length: 9 }, (_, i) => ({ role: 'code_reviewer', task: `c${i}` })), () => ({ content: 'fine' }))
    await h.start({ mode: 'review' })
    await h.done()
    expect(h.finalAgents().length).toBe(6)
  })
})
