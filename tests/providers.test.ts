import { describe, it, expect } from 'vitest'
import { fetchLmStudioModels, fetchOllamaModels, parseGroqModels, parseLmStudioModels, parseOpenRouterModels } from '../src/main/providers/discovery'
import { fetchProviderModels } from '../src/main/providers/registry'
import { fakeFetch, json } from './fakeFetch'

describe('Groq discovery (GET /models)', () => {
  const body = {
    object: 'list',
    data: [
      { id: 'llama-3.3-70b-versatile', active: true, context_window: 131072, max_completion_tokens: 32768 },
      { id: 'openai/gpt-oss-120b', active: true, context_window: 131072, max_completion_tokens: 65536 },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', active: true, context_window: 131072 },
      { id: 'groq/compound', active: true, context_window: 131072 },
      { id: 'old-model', active: false, context_window: 8192 },
      { id: 'whisper-large-v3', active: true, context_window: 448 },
      { id: 'meta-llama/llama-guard-4-12b', active: true, context_window: 131072 },
      { id: 'playai-tts', active: true, context_window: 8192 }
    ]
  }
  it('keeps active chat models with their capability record', () => {
    const m = parseGroqModels(body)
    expect(m.map((x) => x.id)).toEqual(['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'groq/compound'])
    const llama = m[0]
    expect(llama).toMatchObject({ provider: 'groq', tools: true, vision: false, reasoning: false, contextTokens: 131072, maxOutputTokens: 32768, free: false, local: false, thinking: 'app' })
    expect(m[1]).toMatchObject({ reasoning: true, thinking: 'native', tools: true })
    expect(m[2].vision).toBe(true)
    expect(m[3].tools).toBe(false)
  })
})

describe('OpenRouter discovery (GET /models)', () => {
  const body = {
    data: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (free)', context_length: 131072, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools', 'tool_choice', 'max_tokens'], top_provider: { max_completion_tokens: 8192 } },
      { id: 'openai/gpt-5', name: 'OpenAI: GPT-5', context_length: 400000, architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] }, pricing: { prompt: '0.00000125', completion: '0.00001' }, supported_parameters: ['tools', 'reasoning', 'include_reasoning'] },
      { id: 'some/zero-priced', name: 'Zero', context_length: 32768, architecture: { modality: 'text->text' }, pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
      { id: 'openrouter/auto', name: 'Auto Router', context_length: 2000000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '-1', completion: '-1' }, supported_parameters: ['tools'] },
      { id: 'google/gemini-2.5-flash-image', name: 'Nano Banana', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] }, pricing: { prompt: '0.0000003', completion: '0.0000025' } },
      { id: 'black-forest-labs/flux', name: 'Flux', architecture: { input_modalities: ['text'], output_modalities: ['image'] }, pricing: { prompt: '0', completion: '0' } }
    ]
  }
  it('reads tools, vision, reasoning, context and free from the listing', () => {
    const m = parseOpenRouterModels(body)
    const by = Object.fromEntries(m.map((x) => [x.id, x]))
    expect(Object.keys(by)).toEqual(['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-5', 'some/zero-priced', 'openrouter/auto', 'google/gemini-2.5-flash-image'])
    expect(by['meta-llama/llama-3.3-70b-instruct:free']).toMatchObject({ label: 'Meta: Llama 3.3 70B Instruct (free)', tools: true, vision: false, reasoning: false, free: true, contextTokens: 131072, maxOutputTokens: 8192, local: false })
    expect(by['openai/gpt-5']).toMatchObject({ tools: true, vision: true, reasoning: true, thinking: 'native', free: false, contextTokens: 400000 })
    expect(by['some/zero-priced']).toMatchObject({ free: true, tools: false })
    expect(by['openrouter/auto'].free).toBe(false) // -1 means variable pricing, not free
  })
})

describe('Ollama discovery (GET /api/tags + POST /api/show)', () => {
  const base = 'http://localhost:11434'
  const shows: Record<string, unknown> = {
    'qwen3:8b': { capabilities: ['completion', 'tools', 'thinking'], model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40960 } },
    'llava:latest': { capabilities: ['completion', 'vision'], model_info: { 'llama.context_length': 4096 } },
    'nomic-embed-text:latest': { capabilities: ['embedding'], model_info: {} }
  }
  const routes = {
    [`${base}/api/tags`]: () => json({ models: [{ name: 'qwen3:8b', details: { parameter_size: '8.2B' } }, { name: 'llava:latest' }, { name: 'nomic-embed-text:latest' }, { name: 'broken:1b' }] }),
    [`${base}/api/show`]: (init?: RequestInit) => {
      const name = JSON.parse(String(init?.body)).model
      return shows[name] ? json(shows[name]) : json({ error: 'boom' }, 500)
    }
  }
  it('reads capabilities and context length, drops embedding models', async () => {
    const m = await fetchOllamaModels(base, fakeFetch(routes))
    expect(m.map((x) => x.id)).toEqual(['qwen3:8b', 'llava:latest', 'broken:1b'])
    expect(m[0]).toMatchObject({ provider: 'ollama', label: 'qwen3:8b (8.2B)', tools: true, reasoning: true, thinking: 'native', vision: false, contextTokens: 40960, local: true, free: false })
    expect(m[1]).toMatchObject({ label: 'llava', vision: true, tools: false, contextTokens: 4096 })
    // /api/show failed: listed, capabilities unknown
    expect(m[2]).toMatchObject({ tools: false, vision: false, contextTokens: undefined })
  })
  it('reports a server that is not running as a network error', async () => {
    await expect(fetchOllamaModels(base, fakeFetch({}))).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('LM Studio discovery', () => {
  const base = 'http://localhost:1234'
  it('reads /api/v1/models: tool use, vision, reasoning and loaded context', async () => {
    const body = {
      models: [
        { type: 'llm', key: 'qwen/qwen3-8b', display_name: 'Qwen3 8B', max_context_length: 32768, capabilities: { vision: false, trained_for_tool_use: true, reasoning: { allowed_options: ['on', 'off'] } }, loaded_instances: [{ id: 'qwen/qwen3-8b', config: { context_length: 4096 } }] },
        { type: 'llm', key: 'google/gemma-3-12b', display_name: 'Gemma 3 12B', max_context_length: 131072, capabilities: { vision: true, trained_for_tool_use: false } },
        { type: 'embedding', key: 'text-embedding-nomic' }
      ]
    }
    const r = await fetchLmStudioModels(base, fakeFetch({ [`${base}/api/v1/models`]: () => json(body) }))
    expect(r.models.map((m) => m.id)).toEqual(['qwen/qwen3-8b', 'google/gemma-3-12b'])
    expect(r.models[0]).toMatchObject({ provider: 'lmstudio', label: 'Qwen3 8B', tools: true, reasoning: true, vision: false, contextTokens: 4096, local: true })
    expect(r.models[1]).toMatchObject({ tools: false, vision: true, contextTokens: 131072 })
    expect(r.smallContext).toBe(4096)
  })
  it('reads the older /api/v0-style entries', () => {
    const r = parseLmStudioModels({ data: [{ id: 'mistral-7b', type: 'llm', capabilities: ['tool_use'], loaded_context_length: 32768, max_context_length: 32768 }, { id: 'qwen2-vl', type: 'vlm' }] })
    expect(r.models[0]).toMatchObject({ id: 'mistral-7b', tools: true, contextTokens: 32768 })
    expect(r.models[1]).toMatchObject({ vision: true, tools: false })
    expect(r.smallContext).toBeUndefined()
  })
  it('falls back to /v1/models when /api/v1/models does not exist', async () => {
    const r = await fetchLmStudioModels(base, fakeFetch({ [`${base}/api/v1/models`]: () => json({ error: 'Unexpected endpoint' }, 404), [`${base}/v1/models`]: () => json({ data: [{ id: 'llama-3.2-3b-instruct' }, { id: 'text-embedding-nomic-embed-text-v1.5' }] }) }))
    expect(r.models).toEqual([{ provider: 'lmstudio', id: 'llama-3.2-3b-instruct', label: 'llama-3.2-3b-instruct', vision: false, tools: false, reasoning: false, thinking: 'app', free: false, local: true }])
  })
})

describe('cloud providers get the same capability record', () => {
  it('OpenAI and Anthropic models carry tools, reasoning, free and local', async () => {
    const f = fakeFetch({
      'https://api.openai.com/v1/models': () => json({ data: [{ id: 'gpt-5' }, { id: 'text-embedding-3-small' }] }),
      'https://api.anthropic.com/v1/models*': () => json({ data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', max_input_tokens: 200000, capabilities: { image_input: true } }], has_more: false })
    })
    const oa = await fetchProviderModels('openai', 'sk-test', f)
    expect(oa).toEqual([expect.objectContaining({ id: 'gpt-5', tools: true, vision: true, reasoning: true, free: false, local: false })])
    const an = await fetchProviderModels('anthropic', 'sk-ant-test', f)
    expect(an[0]).toMatchObject({ id: 'claude-sonnet-4-5', tools: true, vision: true, contextTokens: 200000, free: false, local: false })
  })
})
