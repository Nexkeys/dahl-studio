import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModelInfo } from '../src/shared/types'
import { DahlError, streamChat } from '../src/main/dahl/client'
import { ModelRegistry } from '../src/main/providers/registry'
import { extractContentToolCalls, shapeGroq } from '../src/main/providers/quirks'
import { fakeFetch, json, ndjson, sse, type Route } from './fakeFetch'

const TOOLS = [{ type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }]
const sig = () => new AbortController().signal
const call = (f: typeof fetch) => streamChat('k', { model: 'm', messages: [] }, sig(), {}, f)
const once = (r: () => Response): typeof fetch => (async () => r()) as unknown as typeof fetch

describe('stream quirks (OpenAI-compatible client)', () => {
  it('accepts delta.reasoning as well as reasoning_content', async () => {
    const r = await call(once(() => sse([{ choices: [{ delta: { reasoning: 'plan ' } }] }, { choices: [{ delta: { reasoning_content: 'more' } }] }, { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])))
    expect(r.reasoning).toBe('plan more')
    expect(r.content).toBe('ok')
  })
  it('accepts message.reasoning when a gateway answers with plain JSON', async () => {
    const r = await call(once(() => json({ choices: [{ message: { content: 'done', reasoning: 'why' }, finish_reason: 'stop' }] })))
    expect(r).toMatchObject({ content: 'done', reasoning: 'why', finishReason: 'stop' })
  })
  it('skips SSE comment lines (OpenRouter keep-alives)', async () => {
    const r = await call(once(() => sse([': OPENROUTER PROCESSING', { choices: [{ delta: { content: 'hi' } }] }, ': OPENROUTER PROCESSING', { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]'])))
    expect(r.content).toBe('hi')
  })
  it('turns an error object inside a 200 stream into a DahlError', async () => {
    const p = call(once(() => sse([{ choices: [{ delta: { content: 'half an ans' } }] }, { error: { code: 'server_error', message: 'Provider disconnected' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] }])))
    await expect(p).rejects.toBeInstanceOf(DahlError)
    await expect(p).rejects.toMatchObject({ kind: 'server', message: expect.stringMatching(/Provider disconnected/) })
  })
  it('turns finish_reason "error" without an error object into a DahlError', async () => {
    await expect(call(once(() => sse([{ choices: [{ delta: { content: 'x' } }] }, { choices: [{ delta: {}, finish_reason: 'error' }] }, '[DONE]'])))).rejects.toMatchObject({ kind: 'server' })
  })
  it('still treats a stream that just stops as a dropped connection', async () => {
    await expect(call(once(() => sse([{ choices: [{ delta: { content: 'Ran the full' } }] }])))).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('Groq request shape', () => {
  it('uses max_completion_tokens, forces n = 1 and drops unsupported fields', () => {
    const body: Record<string, unknown> = { model: 'llama-3.3-70b-versatile', max_tokens: 900, n: 3, logprobs: true, top_logprobs: 2, tools: TOOLS }
    shapeGroq('llama-3.3-70b-versatile')(body)
    expect(body).toEqual({ model: 'llama-3.3-70b-versatile', max_completion_tokens: 900, n: 1, tools: TOOLS })
  })
})

describe('provider quirks through the registry', () => {
  let dir: string
  let seen: { url: string; init?: RequestInit }[]
  const model = (key: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({ key, provider: key.split(':')[0] as ModelInfo['provider'], id: key.slice(key.indexOf(':') + 1), label: key, vision: false, thinking: 'app', firstSeenAt: '', ...extra })
  const registry = async (models: ModelInfo[], routes: Record<string, Route>) => {
    await fs.writeFile(path.join(dir, 'models.json'), JSON.stringify({ seen: {}, models, errors: {} }))
    return new ModelRegistry({ appDir: dir, getKey: async (s) => (s === 'groq' ? 'gsk_test' : s === 'openrouter' ? 'sk-or-test' : null), getPreferred: async () => 'primary', onUsage: () => {}, onHealth: () => {}, onModels: () => {}, fetchImpl: fakeFetch(routes, seen) })
  }
  const body = (i = 0) => JSON.parse(String(seen[i].init?.body))
  const done = () => sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, '[DONE]'])
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-quirks-'))
    seen = []
  })
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }))

  it('OpenRouter: app headers, and require_parameters only when tools are sent', async () => {
    const reg = await registry([model('openrouter:meta-llama/llama-3.3-70b-instruct:free', { tools: true })], { 'https://openrouter.ai/api/v1/chat/completions': done })
    await reg.chat({ model: 'openrouter:meta-llama/llama-3.3-70b-instruct:free', messages: [{ role: 'user', content: 'hi' }], tools: TOOLS }, sig())
    await reg.chat({ model: 'openrouter:meta-llama/llama-3.3-70b-instruct:free', messages: [{ role: 'user', content: 'hi' }] }, sig())
    const h = seen[0].init?.headers as Record<string, string>
    expect(h).toMatchObject({ Authorization: 'Bearer sk-or-test', 'HTTP-Referer': expect.stringContaining('github.com'), 'X-OpenRouter-Title': 'Dahl Studio' })
    expect(body(0)).toMatchObject({ model: 'meta-llama/llama-3.3-70b-instruct:free', provider: { require_parameters: true } })
    expect(body(1).provider).toBeUndefined()
  })

  it('Groq: gpt-oss gets parallel_tool_calls false, other models do not; no max_tokens is sent', async () => {
    const reg = await registry([model('groq:openai/gpt-oss-120b', { tools: true }), model('groq:llama-3.3-70b-versatile', { tools: true })], { 'https://api.groq.com/openai/v1/chat/completions': done })
    await reg.chat({ model: 'groq:openai/gpt-oss-120b', messages: [{ role: 'user', content: 'hi' }], tools: TOOLS }, sig())
    await reg.chat({ model: 'groq:llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hi' }], tools: TOOLS }, sig())
    expect(body(0)).toMatchObject({ model: 'openai/gpt-oss-120b', parallel_tool_calls: false })
    expect(body(1).parallel_tool_calls).toBeUndefined()
    for (const i of [0, 1]) expect(body(i).max_tokens).toBeUndefined()
  })

  it('Groq: a 400 tool_use_failed is retried once, not more', async () => {
    const failed = () => json({ error: { message: 'Failed to call a function. Please adjust your prompt.', type: 'invalid_request_error', code: 'tool_use_failed', failed_generation: '<function=read_file>' } }, 400)
    let n = 0
    const reg = await registry([model('groq:llama-3.3-70b-versatile', { tools: true })], { 'https://api.groq.com/openai/v1/chat/completions': () => (n++ === 0 ? failed() : done()) })
    const r = await reg.chat({ model: 'groq:llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hi' }], tools: TOOLS }, sig())
    expect(r.content).toBe('ok')
    expect(n).toBe(2)
    seen = []
    const always = await registry([model('groq:llama-3.3-70b-versatile', { tools: true })], { 'https://api.groq.com/openai/v1/chat/completions': failed })
    await expect(always.chat({ model: 'groq:llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hi' }], tools: TOOLS }, sig())).rejects.toMatchObject({ kind: 'bad_request', code: 'tool_use_failed' })
    expect(seen).toHaveLength(2)
  })

  it('Ollama: native /api/chat with num_ctx (model max capped at 32k), thinking and tool calls', async () => {
    const stream = () => ndjson([
      { message: { role: 'assistant', content: '', thinking: 'Let me look. ' }, done: false },
      { message: { role: 'assistant', content: 'Reading it.' }, done: false },
      { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.ts' } } }] }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 1200, eval_count: 40 }
    ])
    const reg = await registry([model('ollama:qwen3:8b', { tools: true, reasoning: true, thinking: 'native', contextTokens: 40960 }), model('ollama:phi3:mini', { tools: true, contextTokens: 8192 })], { 'http://localhost:11434/api/chat': stream })
    const r = await reg.chat({ model: 'ollama:qwen3:8b', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], tools: TOOLS, thinking: 'medium' }, sig())
    expect(seen[0].url).toBe('http://localhost:11434/api/chat')
    expect(body(0)).toMatchObject({ model: 'qwen3:8b', stream: true, options: { num_ctx: 32768 }, think: true, tools: TOOLS })
    expect(r).toMatchObject({ content: 'Reading it.', reasoning: 'Let me look. ', finishReason: 'tool_calls', usage: { prompt_tokens: 1200, completion_tokens: 40 } })
    expect(r.toolCalls).toEqual([{ id: expect.any(String), type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }])
    await reg.chat({ model: 'ollama:phi3:mini', messages: [{ role: 'user', content: 'hi' }] }, sig())
    expect(body(1).options.num_ctx).toBe(8192)
    expect(body(1).think).toBeUndefined()
  })

  it('Ollama: a stream without its done line is a dropped connection', async () => {
    const reg = await registry([model('ollama:qwen3:8b', { tools: true })], { 'http://localhost:11434/api/chat': () => ndjson([{ message: { content: 'half' }, done: false }]) })
    await expect(reg.chat({ model: 'ollama:qwen3:8b', messages: [] }, new AbortController().signal, {})).rejects.toMatchObject({ kind: 'network' })
  })

  it('Ollama: a model without the tools capability gets them in the prompt, and its text call becomes a tool call', async () => {
    const reg = await registry([model('ollama:gemma3:4b', { tools: false })], { 'http://localhost:11434/api/chat': () => ndjson([{ message: { content: 'I will read it.\n<tool_call>{"name": "read_file", "arguments": {"path": "src/a.ts"}}</tool_call>' }, done: true, done_reason: 'stop' }]) })
    const r = await reg.chat({ model: 'ollama:gemma3:4b', messages: [{ role: 'system', content: 'You are Dahl.' }, { role: 'user', content: 'read a' }], tools: TOOLS }, sig())
    const b = body(0)
    expect(b.tools).toBeUndefined()
    expect(b.messages[0].content).toMatch(/You are Dahl\.[\s\S]*<tool_call>[\s\S]*read_file/)
    expect(r.toolCalls.map((c) => c.function)).toEqual([{ name: 'read_file', arguments: '{"path":"src/a.ts"}' }])
    expect(r.content).toBe('I will read it.')
  })

  it('LM Studio: a tool call written into the reply text becomes a real tool call', async () => {
    const reply = () => sse([{ choices: [{ delta: { content: '[TOOL_REQUEST]{"name": "read_file", "arguments": {"path": "README.md"}}[END_TOOL_REQUEST]' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }])
    const reg = await registry([model('lmstudio:google/gemma-3-12b', { tools: false, local: true })], { 'http://localhost:1234/v1/chat/completions': reply })
    const r = await reg.chat({ model: 'lmstudio:google/gemma-3-12b', messages: [{ role: 'user', content: 'read the readme' }], tools: TOOLS }, sig())
    expect(seen[0].url).toBe('http://localhost:1234/v1/chat/completions')
    expect(r).toMatchObject({ content: '', finishReason: 'tool_calls' })
    expect(r.toolCalls[0].function).toEqual({ name: 'read_file', arguments: '{"path":"README.md"}' })
  })
})

describe('extractContentToolCalls', () => {
  const x = (s: string) => extractContentToolCalls(s, TOOLS)
  it('reads a ```json fence and bare JSON', () => {
    expect(x('```json\n{"name": "read_file", "arguments": {"path": "a"}}\n```').toolCalls[0].function.arguments).toBe('{"path":"a"}')
    expect(x('{"name":"read_file","parameters":{"path":"b"}}').toolCalls[0].function.arguments).toBe('{"path":"b"}')
    expect(x('{"function": {"name": "read_file", "arguments": "{\\"path\\":\\"c\\"}"}}').toolCalls[0].function.arguments).toBe('{"path":"c"}')
  })
  it('reads several calls and keeps the prose', () => {
    const r = x('First this.\n<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>\n<tool_call>{"name":"read_file","arguments":{"path":"b"}}</tool_call>')
    expect(r.toolCalls).toHaveLength(2)
    expect(r.content).toBe('First this.')
  })
  it('leaves replies alone that only show JSON or name an unknown tool', () => {
    const shown = 'Your config could look like this:\n```json\n{"name": "my-app", "version": "1.0.0"}\n```'
    expect(x(shown)).toEqual({ content: shown, toolCalls: [] })
    expect(x('{"name": "delete_everything", "arguments": {}}').toolCalls).toEqual([])
    expect(extractContentToolCalls('{"name":"read_file","arguments":{}}', undefined).toolCalls).toEqual([])
  })
})
