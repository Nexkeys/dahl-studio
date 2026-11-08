import { describe, it, expect } from 'vitest'
import type { KeyInfo, LocalProviderStatus, ModelInfo, ProviderId } from '../src/shared/types'
import { buildModelMenu, modelBadges, moveHighlight, providerAccess, pushRecent, selectableRows, type MenuInput, type MenuRow } from '../src/shared/modelMenu'
import { contextLabel, normalizeLocalBase, splitModelKey } from '../src/shared/models'

const m = (key: string, label: string, extra: Partial<ModelInfo> = {}): ModelInfo => {
  const { provider, id } = splitModelKey(key)
  return { key, provider, id, label, vision: false, thinking: 'app', firstSeenAt: '', ...extra }
}
const MODELS = [
  m('dahl:MiniMaxAI/MiniMax-M2.7', 'MiniMaxAI/MiniMax-M2.7', { tools: true }),
  m('openai:gpt-5', 'gpt-5', { tools: true, vision: true }),
  m('groq:llama-3.3-70b-versatile', 'llama-3.3-70b-versatile', { tools: true }),
  m('groq:openai/gpt-oss-120b', 'openai/gpt-oss-120b', { tools: true, isNew: true }),
  m('openrouter:meta-llama/llama-3.3-70b-instruct:free', 'Meta: Llama 3.3 70B Instruct (free)', { tools: true, free: true }),
  m('openrouter:openai/gpt-5', 'OpenAI: GPT-5', { tools: true, vision: true }),
  m('ollama:qwen3:8b', 'qwen3:8b (8.2B)', { tools: true, local: true })
]
const key = (slot: KeyInfo['slot'], provider: ProviderId, configured: boolean, health: KeyInfo['health'] = 'ok'): KeyInfo => ({ slot, provider, name: slot, configured, health })
const KEYS = [key('primary', 'dahl', true), key('secondary', 'dahl', false), key('openai', 'openai', true, 'auth_failed'), key('groq', 'groq', true), key('openrouter', 'openrouter', true), key('anthropic', 'anthropic', false)]
const LOCAL: LocalProviderStatus[] = [{ provider: 'ollama', baseUrl: 'http://localhost:11434', running: true, models: 1, checkedAt: '' }, { provider: 'lmstudio', baseUrl: 'http://localhost:1234', running: false, models: 0, checkedAt: '' }]
const menu = (over: Partial<MenuInput> = {}): MenuRow[] => buildModelMenu({ models: MODELS, query: '', expanded: [], recent: [], keys: KEYS, local: LOCAL, ...over })
const shape = (rows: MenuRow[]) => rows.map((r) => (r.kind === 'section' ? `# ${r.label}` : r.kind === 'provider' ? `${r.expanded ? 'v' : '>'} ${r.name} ${r.count}/${r.total} ${r.accessLabel}` : `  ${r.model.key}${r.recent ? ' (recent)' : ''}`))

describe('model menu: rows without a search', () => {
  it('lists every provider collapsed, with model count and key or local status', () => {
    expect(shape(menu())).toEqual([
      '> Dahl 1/1 Key set', '> OpenAI 1/1 Key failed', '> Anthropic 0/0 No key', '> Google Gemini 0/0 No key', '> NVIDIA 0/0 No key',
      '> Groq 2/2 Key set', '> OpenRouter 2/2 Key set', '> Ollama 1/1 Running', '> LM Studio 0/0 Not running'
    ])
  })
  it('puts recently used models first (only ones still listed) and opens clicked providers', () => {
    const rows = menu({ recent: ['groq:openai/gpt-oss-120b', 'gone:model', 'ollama:qwen3:8b'], expanded: ['groq'] })
    expect(shape(rows).slice(0, 9)).toEqual([
      '# Recently used', '  groq:openai/gpt-oss-120b (recent)', '  ollama:qwen3:8b (recent)', '# Providers',
      '> Dahl 1/1 Key set', '> OpenAI 1/1 Key failed', '> Anthropic 0/0 No key', '> Google Gemini 0/0 No key', '> NVIDIA 0/0 No key'
    ])
    expect(shape(rows).slice(9, 12)).toEqual(['v Groq 2/2 Key set', '  groq:llama-3.3-70b-versatile', '  groq:openai/gpt-oss-120b'])
  })
})

describe('model menu: search', () => {
  it('a provider name shows all of its models', () => {
    expect(shape(menu({ query: 'groq' }))).toEqual(['v Groq 2/2 Key set', '  groq:llama-3.3-70b-versatile', '  groq:openai/gpt-oss-120b'])
  })
  it('all words must match, in any order, across provider, name and id', () => {
    expect(shape(menu({ query: 'llama free' }))).toEqual(['v OpenRouter 1/2 Key set', '  openrouter:meta-llama/llama-3.3-70b-instruct:free'])
    expect(shape(menu({ query: 'GPT-5 openai' }))).toEqual(['v OpenAI 1/1 Key failed', '  openai:gpt-5', 'v OpenRouter 1/2 Key set', '  openrouter:openai/gpt-5'])
  })
  it('badge words match: vision, local, new', () => {
    expect(selectableRows(menu({ query: 'vision' })).filter((r) => r.kind === 'model').map((r) => r.id)).toEqual(['model:openai:gpt-5', 'model:openrouter:openai/gpt-5'])
    expect(shape(menu({ query: 'local' }))).toEqual(['v Ollama 1/1 Running', '  ollama:qwen3:8b'])
    expect(shape(menu({ query: 'new' }))).toEqual(['v Groq 1/2 Key set', '  groq:openai/gpt-oss-120b'])
  })
  it('hides the recently used section while searching, and finds nothing for nonsense', () => {
    expect(menu({ query: 'qwen', recent: ['ollama:qwen3:8b'] }).some((r) => r.kind === 'section')).toBe(false)
    expect(selectableRows(menu({ query: 'zzz nothing' }))).toEqual([])
  })
})

describe('model menu: keyboard and helpers', () => {
  it('moves over providers and models, skips section titles and wraps', () => {
    const rows = menu({ recent: ['ollama:qwen3:8b'] })
    expect(moveHighlight(rows, null, 1)).toBe('recent:ollama:qwen3:8b')
    expect(moveHighlight(rows, 'recent:ollama:qwen3:8b', 1)).toBe('provider:dahl')
    expect(moveHighlight(rows, 'provider:dahl', -1)).toBe('recent:ollama:qwen3:8b')
    expect(moveHighlight(rows, 'recent:ollama:qwen3:8b', -1)).toBe('provider:lmstudio')
    expect(moveHighlight(rows, null, -1)).toBe('provider:lmstudio')
    expect(moveHighlight([], null, 1)).toBeNull()
  })
  it('badges, provider access, recents, labels', () => {
    expect(modelBadges(MODELS[4])).toEqual(['tools', 'free'])
    expect(modelBadges({ ...MODELS[6], isNew: true, vision: true })).toEqual(['vision', 'tools', 'local', 'new'])
    expect(providerAccess('openai', [key('openai', 'openai', true, 'exhausted')], []).label).toBe('No credit')
    expect(providerAccess('lmstudio', [], []).label).toBe('Not checked')
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(pushRecent(undefined, 'x')).toEqual(['x'])
    expect(pushRecent(['1', '2', '3', '4', '5', '6', '7', '8'], '9')).toHaveLength(8)
    expect([contextLabel(131072), contextLabel(1048576), contextLabel(undefined)]).toEqual(['128k', '1M', ''])
  })
  it('normalises a typed local server address', () => {
    expect(normalizeLocalBase(' localhost:11434/ ')).toBe('http://localhost:11434')
    expect(normalizeLocalBase('http://192.168.1.20:1234/v1')).toBe('http://192.168.1.20:1234')
    expect(normalizeLocalBase('http://localhost:11434/api')).toBe('http://localhost:11434')
    expect(normalizeLocalBase('ftp://x')).toBeNull()
    expect(normalizeLocalBase('')).toBeNull()
  })
})
