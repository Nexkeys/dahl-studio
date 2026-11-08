import { describe, it, expect, afterEach } from 'vitest'
import { CompletionService, LIMITS, type CompletionDeps } from '../src/main/completion/service'
import { DahlError } from '../src/main/dahl/client'
import type { CompletionRequest } from '../src/shared/types'

let nextId = 1
const req = (prefix: string, extra: Partial<CompletionRequest> = {}): CompletionRequest =>
  ({ id: nextId++, path: 'src/a.ts', language: 'typescript', prefix, suffix: '\n', ...extra })

/** A fake model: records every call, answers from `answer`, or waits until it is aborted. */
function fakeModel(answer: (n: number) => string | 'hang' | Error = () => '<COMPLETION>a + b</COMPLETION>') {
  const calls: { model: string; extra?: Record<string, unknown>; temperature?: number }[] = []
  const fetches: { url: string; body: any }[] = []
  let clock = 1_000_000
  const settings = { tabCompletions: true as boolean | undefined, completionModel: 'groq:llama-3.1-8b-instant' as string | null }
  const deps: CompletionDeps = {
    getSettings: async () => settings,
    now: () => clock,
    endpoint: async (p) => ({ base: p === 'ollama' ? 'http://127.0.0.1:11434/v1' : 'https://example.test/v1', key: null }),
    chat: (r, signal) => {
      calls.push({ model: r.model, extra: r.extra, temperature: r.temperature })
      const a = answer(calls.length)
      if (a instanceof Error) return Promise.reject(a)
      if (a !== 'hang') return Promise.resolve({ content: a })
      return new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new DahlError('cancelled', 'Request cancelled'))))
    },
    fetch: (async (url: string, init: RequestInit) => {
      fetches.push({ url, body: JSON.parse(String(init.body)) })
      return new Response('{"error":{"message":"model does not support insert"}}', { status: 400 })
    }) as unknown as typeof fetch
  }
  return { deps, calls, fetches, settings, tick: (ms: number) => (clock += ms) }
}

afterEach(() => {
  LIMITS.timeoutMs = 10_000
})

describe('Tab completions service', () => {
  it('sends nothing while off or without a completion model', async () => {
    const m = fakeModel()
    const svc = new CompletionService(m.deps)
    m.settings.tabCompletions = false
    expect(await svc.request(req('return '))).toEqual({ skipped: 'off' })
    m.settings.tabCompletions = undefined
    expect(await svc.request(req('return '))).toEqual({ skipped: 'off' })
    m.settings.tabCompletions = true
    m.settings.completionModel = null
    expect(await svc.request(req('return '))).toEqual({ skipped: 'no_model' })
    expect(m.calls).toHaveLength(0)
    expect(m.fetches).toHaveLength(0)
  })

  it('asks the model with low temperature, few tokens and a stop sequence, and cleans the answer', async () => {
    const m = fakeModel(() => '<COMPLETION>```ts\na + b\n```</COMPLETION>')
    const r = await new CompletionService(m.deps).request(req('return '))
    expect(r.text).toBe('a + b')
    expect(r.cached).toBe(false)
    expect(m.calls[0].model).toBe('groq:llama-3.1-8b-instant')
    expect(m.calls[0].temperature).toBeLessThanOrEqual(0.2)
    expect(m.calls[0].extra).toMatchObject({ max_tokens: 160, stop: ['</COMPLETION>'] })
  })

  it('caches by the text around the cursor (explicit triggers ask again)', async () => {
    const m = fakeModel()
    const svc = new CompletionService(m.deps)
    expect((await svc.request(req('return '))).text).toBe('a + b')
    const again = await svc.request(req('return '))
    expect(again).toMatchObject({ text: 'a + b', cached: true })
    expect(m.calls).toHaveLength(1)
    await svc.request(req('return x'))
    expect(m.calls).toHaveLength(2)
    await svc.request(req('return ', { explicit: true }))
    expect(m.calls).toHaveLength(3)
  })

  it('cancels a stale request when a newer one arrives, and on completion:cancel', async () => {
    const m = fakeModel((n) => (n === 1 || n === 3 ? 'hang' : 'b'))
    const svc = new CompletionService(m.deps)
    const first = svc.request(req('a'))
    await new Promise((res) => setTimeout(res, 5))
    expect(svc.pending).toBe(1)
    const second = await svc.request(req('ab'))
    expect(await first).toEqual({ skipped: 'cancelled' })
    expect(second.text).toBe('b')
    const r = req('abc')
    const third = svc.request(r)
    await new Promise((res) => setTimeout(res, 5))
    svc.cancel(r.id)
    expect(await third).toEqual({ skipped: 'cancelled' })
    expect(svc.pending).toBe(0)
  })

  it('rate limits model calls per minute', async () => {
    const m = fakeModel()
    const svc = new CompletionService(m.deps)
    for (let i = 0; i < LIMITS.perMinute; i++) expect((await svc.request(req(`v${i} = `))).text).toBe('a + b')
    expect(await svc.request(req('over = '))).toEqual({ skipped: 'rate_limited' })
    expect(m.calls).toHaveLength(LIMITS.perMinute)
    m.tick(61_000)
    expect((await svc.request(req('later = '))).text).toBe('a + b')
  })

  it('pauses after an auth error instead of failing on every keystroke', async () => {
    const m = fakeModel((n) => (n === 1 ? new DahlError('auth', 'Authentication failed: bad key') : 'x'))
    const svc = new CompletionService(m.deps)
    expect((await svc.request(req('a = '))).error).toMatch(/bad key.*paused for 60 s/)
    const paused = await svc.request(req('b = '))
    expect(paused.skipped).toBe('paused')
    expect(m.calls).toHaveLength(1)
    m.tick(61_000)
    expect((await svc.request(req('c = '))).text).toBe('x')
  })

  it('reports a model that does not answer in time', async () => {
    LIMITS.timeoutMs = 30
    const m = fakeModel(() => 'hang')
    const r = await new CompletionService(m.deps).request(req('a = '))
    expect(r.error).toMatch(/did not answer/)
  })

  it('uses FIM with suffix for an Ollama coder model, and falls back to the chat prompt when the server refuses it', async () => {
    const m = fakeModel()
    m.settings.completionModel = 'ollama:qwen2.5-coder:1.5b'
    const svc = new CompletionService(m.deps)
    const r = await svc.request(req('const x = ', { suffix: '\nexport { x }' }))
    expect(m.fetches[0].url).toBe('http://127.0.0.1:11434/v1/completions')
    expect(m.fetches[0].body).toMatchObject({ model: 'qwen2.5-coder:1.5b', prompt: '// Path: src/a.ts\nconst x = ', suffix: '\nexport { x }', stream: false })
    expect(r.text).toBe('a + b')
    expect(m.calls).toHaveLength(1)
    await svc.request(req('const y = '))
    expect(m.fetches).toHaveLength(1)
  })

  it('serves fake models only in smoke and dev runs', async () => {
    const m = fakeModel()
    m.settings.completionModel = 'fake:demo'
    expect((await new CompletionService(m.deps).request(req('a'))).error).toMatch(/development/)
    const dev = await new CompletionService({ ...m.deps, allowFake: true }).request(req('function add(a, b) {', { suffix: '}\n' }))
    expect(dev.text).toBe('\n  return a + b\n')
  })
})
