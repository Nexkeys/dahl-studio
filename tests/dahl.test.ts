import { describe, it, expect } from 'vitest'
import { classifyHttpError, streamChat, DahlError } from '../src/main/dahl/client'
import { DahlRouter } from '../src/main/dahl/router'
import type { KeySlot } from '../src/shared/types'

function sseResponse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
const errResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('classifyHttpError (Dahl documented errors)', () => {
  it('maps documented statuses', () => {
    expect(classifyHttpError(401, '{"error":{"message":"invalid API token"}}').kind).toBe('auth')
    expect(classifyHttpError(402, 'available tokens exhausted').kind).toBe('exhausted')
    expect(classifyHttpError(429, '{"error":{"code":"parallel_key_limit"}}').kind).toBe('rate_key')
    expect(classifyHttpError(429, '{"error":{"code":"model_concurrency"}}', '3').retryAfterMs).toBe(3000)
    expect(classifyHttpError(400, '{"error":{"message":"This model is not currently offered"}}').kind).toBe('model_unavailable')
    expect(classifyHttpError(400, '{"error":{"code":"context_length_exceeded"}}').kind).toBe('context_length')
    expect(classifyHttpError(503, 'overloaded').kind).toBe('server')
    expect(classifyHttpError(422, 'bad').kind).toBe('bad_request')
  })
})

describe('streamChat', () => {
  it('parses text, reasoning and tool-call deltas from SSE', async () => {
    const fetchImpl = (async () =>
      sseResponse([
        { choices: [{ delta: { reasoning_content: 'think ' } }] },
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_', arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: 'th":"a.ts"}' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
        '[DONE]'
      ])) as unknown as typeof fetch
    const deltas: string[] = []
    const r = await streamChat('dahl_testkey123', { model: 'm', messages: [] }, new AbortController().signal, { onDelta: (d) => deltas.push(d) }, fetchImpl)
    expect(r.content).toBe('Hello')
    expect(deltas).toEqual(['Hel', 'lo'])
    expect(r.reasoning).toBe('think ')
    expect(r.toolCalls).toEqual([{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }])
    expect(r.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 })
    expect(r.finishReason).toBe('tool_calls')
  })

  it('sends documented request shape with bearer key', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return sseResponse(['[DONE]'])
    }) as unknown as typeof fetch
    await streamChat('dahl_abc123456', { model: 'MiniMaxAI/MiniMax-M2.7', messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal, {}, fetchImpl)
    expect(seen!.url).toBe('https://inference.dahl.global/v1/chat/completions')
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer dahl_abc123456')
    expect(JSON.parse(seen!.init.body as string)).toEqual({ model: 'MiniMaxAI/MiniMax-M2.7', messages: [{ role: 'user', content: 'hi' }], stream: true })
  })

  it('reports cancellation as cancelled', async () => {
    const ctrl = new AbortController()
    const fetchImpl = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch
    const p = streamChat('k', { model: 'm', messages: [] }, ctrl.signal, {}, fetchImpl)
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' })
  })
})

function makeRouter(responses: Partial<Record<KeySlot, Array<() => Response>>>, keys: Partial<Record<KeySlot, string>> = { primary: 'dahl_primary1', secondary: 'dahl_second22' }) {
  const calls: KeySlot[] = []
  const health: string[] = []
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    const auth = (init.headers as Record<string, string>).Authorization
    const slot: KeySlot = auth.includes('primary') ? 'primary' : 'secondary'
    calls.push(slot)
    const next = responses[slot]?.shift()
    if (!next) throw new Error('no more responses')
    return next()
  }) as unknown as typeof fetch
  const router = new DahlRouter({
    getKey: async (s) => keys[s] ?? null,
    getPreferred: async () => 'primary',
    onHealth: (s, h) => health.push(`${s}:${h}`),
    sleep: async () => {},
    fetchImpl
  })
  return { router, calls, health }
}
const ok = () => sseResponse([{ choices: [{ delta: { content: 'ok' } }] }, '[DONE]'])

describe('DahlRouter failover', () => {
  it('fails over to the secondary key on 401', async () => {
    const { router, calls, health } = makeRouter({ primary: [() => errResponse(401, { error: { message: 'invalid' } })], secondary: [ok] })
    const r = await router.chat({ model: 'm', messages: [] }, new AbortController().signal)
    expect(r.slot).toBe('secondary')
    expect(calls).toEqual(['primary', 'secondary'])
    expect(health).toContain('primary:auth_failed')
  })

  it('fails over on 402 exhausted', async () => {
    const { router } = makeRouter({ primary: [() => errResponse(402, { error: { message: 'available tokens exhausted' } })], secondary: [ok] })
    expect((await router.chat({ model: 'm', messages: [] }, new AbortController().signal)).slot).toBe('secondary')
  })

  it('retries transient 503 on the same key with bounded retries', async () => {
    const { router, calls } = makeRouter({ primary: [() => errResponse(503, {}), () => errResponse(503, {}), ok], secondary: [] })
    const r = await router.chat({ model: 'm', messages: [] }, new AbortController().signal)
    expect(r.slot).toBe('primary')
    expect(calls).toEqual(['primary', 'primary', 'primary'])
  })

  it('moves to the secondary key after retries are exhausted', async () => {
    const { router, calls } = makeRouter({ primary: [() => errResponse(502, {}), () => errResponse(502, {}), () => errResponse(502, {})], secondary: [ok] })
    const r = await router.chat({ model: 'm', messages: [] }, new AbortController().signal)
    expect(r.slot).toBe('secondary')
    expect(calls).toEqual(['primary', 'primary', 'primary', 'secondary'])
  })

  it('does not retry or switch keys on invalid requests', async () => {
    const { router, calls } = makeRouter({ primary: [() => errResponse(400, { error: { message: 'This model is not currently offered' } })], secondary: [ok] })
    await expect(router.chat({ model: 'x', messages: [] }, new AbortController().signal)).rejects.toMatchObject({ kind: 'model_unavailable' })
    expect(calls).toEqual(['primary'])
  })

  it('errors clearly when no key is configured', async () => {
    const { router } = makeRouter({ primary: [], secondary: [] }, {})
    await expect(router.chat({ model: 'm', messages: [] }, new AbortController().signal)).rejects.toBeInstanceOf(DahlError)
  })

  it('works with only the secondary key configured', async () => {
    const { router } = makeRouter({ primary: [], secondary: [ok] }, { secondary: 'dahl_second22' })
    expect((await router.chat({ model: 'm', messages: [] }, new AbortController().signal)).slot).toBe('secondary')
  })
})
