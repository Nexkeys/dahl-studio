import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRunner, type ChatBackend } from '../src/main/agent/runner'
import { checkBudget, limitImages, maxHelpers, resolveModelForRole } from '../src/main/agent/budget'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import { emptyTally } from '../src/shared/cost'
import type { AgentEvent, ChatMessage, Settings, TranscriptItem } from '../src/shared/types'

const S = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, autoMemory: false, maintainProgress: false, ...p })

describe('checkBudget', () => {
  const task = (usd: number) => ({ ...emptyTally(), usd, requests: 1 })
  it('passes with no limits or under them', () => {
    expect(checkBudget({ task: task(5), today: 50, next: 1 }, S())).toEqual({ ok: true })
    expect(checkBudget({ task: task(0.1), today: 1, next: 0.1 }, S({ budgetTaskUsd: 0.5, budgetDayUsd: 5 }))).toEqual({ ok: true })
  })
  it('stops when the next call would go over the task limit', () => {
    const r = checkBudget({ task: task(0.45), today: 0, next: 0.1 }, S({ budgetTaskUsd: 0.5 }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/^Budget reached: this task has used \$0\.45 of its \$0\.50 limit/)
  })
  it('stops when today would go over the daily limit', () => {
    const r = checkBudget({ task: task(0), today: 4.99, next: 0.02 }, S({ budgetDayUsd: 5 }))
    expect(!r.ok && r.reason).toMatch(/^Budget reached: \$4\.99 spent today of the \$5\.00 daily limit/)
  })
  it('an unknown price never stops a task on its own', () => {
    expect(checkBudget({ task: task(0.2), today: 0, next: null }, S({ budgetTaskUsd: 0.5 }))).toEqual({ ok: true })
  })
})

describe('resolveModelForRole', () => {
  const run = { model: 'anthropic:claude-opus-5-5' }
  it('defaults every role to the main model', () => {
    for (const r of ['lead', 'architect', 'implementer', 'researcher', 'code_reviewer', 'image', 'autocomplete'] as const) expect(resolveModelForRole(r, run, S())).toBe(run.model)
  })
  it('uses the model chosen per role', () => {
    const s = S({ roleModels: { helpers: 'openai:gpt-5-mini', checker: 'gemini:gemini-2.5-flash', research: 'groq:openai/gpt-oss-120b', image: 'openai:gpt-4.1' } })
    expect(resolveModelForRole('implementer', run, s)).toBe('openai:gpt-5-mini')
    expect(resolveModelForRole('test_engineer', run, s)).toBe('openai:gpt-5-mini')
    expect(resolveModelForRole('security_reviewer', run, s)).toBe('gemini:gemini-2.5-flash')
    expect(resolveModelForRole('researcher', run, s)).toBe('groq:openai/gpt-oss-120b')
    expect(resolveModelForRole('architect', run, s)).toBe(run.model)
    expect(resolveModelForRole('lead', run, s)).toBe(run.model)
    // Best quality runs all agents on the main model; image reading keeps its own choice
    const best = { ...s, qualityPreset: 'best' as const }
    expect(resolveModelForRole('implementer', run, best)).toBe(run.model)
    expect(resolveModelForRole('image', run, best)).toBe('openai:gpt-4.1')
  })
})

describe('Economy limits', () => {
  it('runs fewer helpers and keeps only the newest images', () => {
    expect(maxHelpers(S({ qualityPreset: 'economy' }))).toBe(2)
    expect(maxHelpers(S())).toBe(6)
    const img = (n: string) => ({ type: 'image' as const, mediaType: 'image/png', data: 'x', name: n })
    const msgs: ChatMessage[] = [{ role: 'user', content: [img('a'), img('b')] }, { role: 'user', content: [{ type: 'text', text: 'see' }, img('c')] }]
    const out = limitImages(msgs, 2)
    expect(out.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image').map((p) => (p as { name: string }).name) : []))).toEqual(['b', 'c'])
    expect(msgs[0].content).toHaveLength(2) // history untouched
    expect((msgs[0].content as { type: string }[])[0].type).toBe('image')
  })
})

// ---------------------------------------------------------------- runner integration
let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-budget-'))
  await fs.writeFile(path.join(dir, 'a.ts'), 'a\n')
})
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50))
  await fs.rm(dir, { recursive: true, force: true })
})

type Reply = { content?: string; tool?: { name: string; args: unknown }; prompt?: number }
function harness(script: (sys: string, n: number, req: { model: string }) => Reply, settings: Partial<Settings> = {}) {
  const events: AgentEvent[] = []
  const calls: { model: string; lead: boolean }[] = []
  let n = 0
  const backend: ChatBackend = {
    async chat(req) {
      n++
      const sys = String(req.messages[0].content)
      calls.push({ model: req.model, lead: sys.includes('lead coding agent') })
      const r = script(sys, n, req)
      return {
        content: r.content ?? '', reasoning: '', finishReason: 'stop',
        toolCalls: r.tool ? [{ id: `c${n}`, type: 'function' as const, function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }] : [],
        usage: { prompt_tokens: r.prompt ?? 100_000, completion_tokens: 1000 }
      }
    }
  }
  const runner = new AgentRunner({
    backend, getSettings: async () => S(settings), emit: (e) => void events.push(e),
    runCommand: async () => ({ exitCode: 0, output: 'ok', timedOut: false }), secrets: async () => [],
    spentToday: async () => 0, hasModel: async () => true
  })
  const run = async (model = 'openai:gpt-5') => {
    await runner.start({ project: dir, prompt: 'go', mode: 'build', model })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
  }
  const items = () => events.filter((e) => e.type === 'transcript').map((e) => e.item!) as TranscriptItem[]
  const status = () => [...events].reverse().find((e) => e.type === 'status')?.status
  return { run, items, status, calls }
}

describe('runner: budgets, notes and per-role models', () => {
  it('pauses with "Budget reached" before a call that would go over the task limit, and shows the cost', async () => {
    // gpt-5 at 100,000 input + 1,000 output tokens is $0.135 per call; the second call would pass $0.20
    const h = harness((_s, n) => (n === 1 ? { tool: { name: 'list_dir', args: { path: '' } } } : { content: 'done' }), { budgetTaskUsd: 0.2, warnInputTokens: 0 })
    await h.run()
    expect(h.calls).toHaveLength(1)
    expect(h.status()).toBe('paused')
    const stop = h.items().find((i) => i.notice === 'budget')
    expect(stop?.text).toMatch(/^Budget reached: this task has used \$0\.14 of its \$0\.20 limit and the next step would cost about \$0\.14/)
    const sum = h.items().find((i) => i.kind === 'summary')!.summary!
    expect(sum.cost).toMatchObject({ requests: 1, estimated: true, inputTokens: 100_000 })
    expect(sum.cost!.usd).toBeCloseTo(0.135, 6)
    expect(sum.chatCost!.usd).toBeCloseTo(0.135, 6)
  })

  it('notes a very large request in the chat (once per task)', async () => {
    const h = harness((_s, n) => (n < 3 ? { tool: { name: 'list_dir', args: { path: '' } }, prompt: 10 } : { content: 'done', prompt: 10 }), { warnInputTokens: 50 })
    await h.run('dahl:m')
    const notes = h.items().filter((i) => i.notice === 'cost')
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toMatch(/^Large request: this step sends about [\d,]+ input tokens/)
    expect(h.status()).toBe('completed')
  })

  it('helpers use the model chosen for their role; the lead keeps the main model', async () => {
    const h = harness((sys) => {
      if (!sys.includes('lead coding agent')) return { content: 'implemented' }
      return h.calls.filter((c) => c.lead).length === 1 ? { tool: { name: 'delegate_agents', args: { agents: [{ role: 'implementer', task: 'do a', files: ['a.ts'] }, { role: 'code_reviewer', task: 'review' }] } } } : { content: 'lead done' }
    }, { roleModels: { helpers: 'openai:gpt-5-mini' } })
    await h.run('anthropic:claude-opus-5-5')
    expect(h.calls.filter((c) => c.lead).every((c) => c.model === 'anthropic:claude-opus-5-5')).toBe(true)
    expect(h.calls.filter((c) => !c.lead).map((c) => c.model).sort()).toEqual(['anthropic:claude-opus-5-5', 'openai:gpt-5-mini'])
  })

  it('Economy runs at most 2 helpers at once', async () => {
    const h = harness((sys) => {
      if (!sys.includes('lead coding agent')) return { content: 'ok' }
      return h.calls.filter((c) => c.lead).length === 1 ? { tool: { name: 'delegate_agents', args: { agents: [1, 2, 3].map((i) => ({ role: 'researcher', task: `look ${i}` })) } } } : { content: 'lead done' }
    }, { qualityPreset: 'economy' })
    await h.run('dahl:m')
    expect(h.calls.filter((c) => !c.lead)).toHaveLength(2)
  })
})
