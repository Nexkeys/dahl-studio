import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { KeySlot, ModelInfo, ProviderId } from '../src/shared/types'
import { ModelRegistry } from '../src/main/providers/registry'
import { pickFallbackModel } from '../src/shared/models'
import { fakeFetch, json, type Route } from './fakeFetch'

// Every provider lists two models; then each drops one. The dropped one must disappear on the next refresh.
const LISTS: Record<ProviderId, string[]> = {
  dahl: ['MiniMaxAI/MiniMax-M2.7', 'zai-org/GLM-5.3-Flash'],
  openai: ['gpt-5', 'gpt-4.1'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  nvidia: ['meta/llama-3.3-70b-instruct', 'qwen/qwen3-235b-a22b'],
  groq: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
  openrouter: ['deepseek/deepseek-chat-v3:free', 'openai/gpt-5'],
  ollama: ['qwen3:8b', 'llama3.2:latest'],
  lmstudio: ['qwen/qwen3-8b', 'google/gemma-3-12b']
}

function routes(lists: Record<ProviderId, string[]>, down: Partial<Record<ProviderId, 'error' | 'stopped'>> = {}): Record<string, Route> {
  const r: Record<string, Route> = {
    'https://inference.dahl.global/v1/models': () => json({ data: lists.dahl.map((id) => ({ id })) }),
    'https://api.openai.com/v1/models': () => json({ data: lists.openai.map((id) => ({ id })) }),
    'https://api.anthropic.com/v1/models*': () => json({ data: lists.anthropic.map((id) => ({ id, display_name: id })), has_more: false }),
    'https://generativelanguage.googleapis.com/v1beta/openai/models': () => json({ data: lists.gemini.map((id) => ({ id: `models/${id}` })) }),
    'https://integrate.api.nvidia.com/v1/models': () => json({ data: lists.nvidia.map((id) => ({ id })) }),
    'https://api.groq.com/openai/v1/models': () => json({ data: lists.groq.map((id) => ({ id, active: true, context_window: 131072 })) }),
    'https://openrouter.ai/api/v1/models': () => json({ data: lists.openrouter.map((id) => ({ id, name: id, context_length: 128000, supported_parameters: ['tools'] })) }),
    'http://localhost:11434/api/tags': () => json({ models: lists.ollama.map((name) => ({ name })) }),
    'http://localhost:11434/api/show': () => json({ capabilities: ['completion', 'tools'], model_info: { 'x.context_length': 32768 } }),
    'http://localhost:1234/api/v1/models': () => json({ models: lists.lmstudio.map((key) => ({ type: 'llm', key, capabilities: { trained_for_tool_use: true } })) })
  }
  for (const [p, how] of Object.entries(down)) {
    const prefix = { dahl: 'https://inference', openai: 'https://api.openai', anthropic: 'https://api.anthropic', gemini: 'https://generativelanguage', nvidia: 'https://integrate', groq: 'https://api.groq', openrouter: 'https://openrouter', ollama: 'http://localhost:11434', lmstudio: 'http://localhost:1234' }[p as ProviderId]
    for (const k of Object.keys(r)) if (k.startsWith(prefix)) how === 'stopped' ? delete r[k] : (r[k] = () => json({ error: { message: 'upstream down' } }, 503))
  }
  return r
}

describe('model sync: models a provider stops listing disappear', () => {
  let dir: string
  let keys: Partial<Record<KeySlot, string>>
  let table: Record<string, Route>
  let pushed: ModelInfo[][]
  const make = () =>
    new ModelRegistry({
      appDir: dir,
      getKey: async (s) => keys[s] ?? null,
      getPreferred: async () => 'primary',
      onUsage: () => {},
      onHealth: () => {},
      onModels: (m) => pushed.push(m),
      fetchImpl: ((u: string, i?: RequestInit) => fakeFetch(table)(u, i)) as typeof fetch
    })
  const ids = (m: ModelInfo[], p: ProviderId) => m.filter((x) => x.provider === p).map((x) => x.id).sort()

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-models-'))
    keys = { primary: 'dahl_k', openai: 'sk-o', anthropic: 'sk-a', gemini: 'g', nvidia: 'nv', groq: 'gsk', openrouter: 'sk-or' }
    table = routes(LISTS)
    pushed = []
  })
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }))

  it('for every provider, including OpenAI and Anthropic', async () => {
    const reg = make()
    const first = await reg.refresh()
    for (const p of Object.keys(LISTS) as ProviderId[]) expect(ids(first.models, p), p).toEqual([...LISTS[p]].sort())
    expect(first.errors).toEqual({})
    // each provider drops its first model
    table = routes(Object.fromEntries(Object.entries(LISTS).map(([p, l]) => [p, l.slice(1)])) as Record<ProviderId, string[]>)
    const second = await reg.refresh()
    for (const p of Object.keys(LISTS) as ProviderId[]) expect(ids(second.models, p), p).toEqual([LISTS[p][1]])
    // the app is told, and the catalogue on disk agrees (a restart does not bring them back)
    expect(pushed.at(-1)).toEqual(second.models)
    const again = await make().list()
    expect(again.models.map((m) => m.key).sort()).toEqual(second.models.map((m) => m.key).sort())
  })

  it('keeps the last known list while a provider is failing, and records why', async () => {
    const reg = make()
    await reg.refresh()
    table = routes(LISTS, { groq: 'error', openai: 'error' })
    const r = await reg.refresh()
    expect(ids(r.models, 'groq')).toEqual([...LISTS.groq].sort())
    expect(ids(r.models, 'openai')).toEqual([...LISTS.openai].sort())
    expect(r.errors.groq).toMatch(/upstream down/)
  })

  it('a removed key takes its models away; a stopped local server too, without an error', async () => {
    const reg = make()
    await reg.refresh()
    delete keys.openrouter
    delete keys.anthropic
    table = routes(LISTS, { ollama: 'stopped' })
    const r = await reg.refresh()
    expect(ids(r.models, 'openrouter')).toEqual([])
    expect(ids(r.models, 'anthropic')).toEqual([])
    expect(ids(r.models, 'ollama')).toEqual([])
    expect(r.errors.ollama).toBeUndefined()
    expect(r.local.find((l) => l.provider === 'ollama')).toMatchObject({ running: false, models: 0, baseUrl: 'http://localhost:11434' })
    expect(r.local.find((l) => l.provider === 'lmstudio')).toMatchObject({ running: true, models: 2 })
  })

  it('a provider listed for the first time is not "new"; a model it adds later is', async () => {
    const reg = make()
    await reg.refresh()
    table = routes({ ...LISTS, groq: [...LISTS.groq, 'moonshotai/kimi-k2-instruct'] })
    const r = await reg.refresh('groq')
    expect(r.models.filter((m) => m.isNew).map((m) => m.key)).toEqual(['groq:moonshotai/kimi-k2-instruct'])
  })
})

describe('a chosen model that vanished falls back to a valid one', () => {
  const m = (key: string): ModelInfo => ({ key, provider: key.split(':')[0] as ProviderId, id: key.slice(key.indexOf(':') + 1), label: key, vision: false, thinking: 'app', firstSeenAt: '' })
  const list = [m('dahl:MiniMaxAI/MiniMax-M2.7'), m('groq:llama-3.3-70b-versatile'), m('openrouter:openai/gpt-5'), m('ollama:qwen3:8b')]
  it('keeps a model that is still listed', () => expect(pickFallbackModel('groq:llama-3.3-70b-versatile', list)).toBeNull())
  it('prefers the most recently used model that is still listed', () =>
    expect(pickFallbackModel('ollama:llama3.2:latest', list, ['ollama:llama3.2:latest', 'gone:x', 'openrouter:openai/gpt-5'])?.key).toBe('openrouter:openai/gpt-5'))
  it('then a model from the same provider, then Dahl, then the first', () => {
    expect(pickFallbackModel('ollama:llama3.2:latest', list)?.key).toBe('ollama:qwen3:8b')
    expect(pickFallbackModel('lmstudio:gone', list)?.key).toBe('dahl:MiniMaxAI/MiniMax-M2.7')
    expect(pickFallbackModel(null, list.slice(1))?.key).toBe('groq:llama-3.3-70b-versatile')
  })
  it('does nothing while no models are listed yet', () => expect(pickFallbackModel('groq:x', [])).toBeNull())
})
