import { describe, it, expect } from 'vitest'
import { costOf, findPrice, inputCostOf, priceRows, PRICES_CHECKED } from '../src/main/pricing'
import { addToTally } from '../src/main/pricing'
import { emptyTally, formatUsd, mergeTally } from '../src/shared/cost'
import { readAnthropicUsage, readUsage, usageCounts } from '../src/main/providers/usage'
import { addCacheBreakpoints } from '../src/main/providers/anthropicCache'
import { anthropicStream } from '../src/main/providers/anthropic'

const close = (a: number | null, b: number) => expect(a).toBeCloseTo(b, 10)

describe('pricing: cost of one request', () => {
  it('OpenAI: cached input is billed at the cached price, the rest at the input price', () => {
    // gpt-5: $1.25 in, $0.125 cached, $10 out per 1M
    const c = costOf('openai:gpt-5', { promptTokens: 1_000_000, cachedTokens: 400_000, completionTokens: 100_000 })
    close(c.usd, 0.6 * 1.25 + 0.4 * 0.125 + 0.1 * 10)
    expect(c).toMatchObject({ exact: false, source: 'table' })
  })

  it('Anthropic: dated ids match, cache reads and 5-minute writes use their own prices', () => {
    // claude-sonnet-4-5: $3 in, $0.30 cache hits, $3.75 5m writes, $15 out
    const c = costOf('anthropic:claude-sonnet-4-5-20250929', { promptTokens: 10_000, cachedTokens: 6_000, cacheWriteTokens: 2_000, completionTokens: 1_000 })
    close(c.usd, (2_000 * 3 + 6_000 * 0.3 + 2_000 * 3.75 + 1_000 * 15) / 1e6)
  })

  it('long prompts switch to the long-context prices (Claude Haiku 5.5 above 100,000 tokens)', () => {
    close(costOf('anthropic:claude-haiku-5-5', { promptTokens: 150_000, completionTokens: 1_000 }).usd, (150_000 * 0.5 + 1_000 * 2.5) / 1e6)
    close(costOf('anthropic:claude-haiku-5-5', { promptTokens: 90_000, completionTokens: 1_000 }).usd, (90_000 * 0.1 + 1_000 * 0.5) / 1e6)
  })

  it('never guesses: unlisted models, dated OpenAI snapshots and NVIDIA are unknown', () => {
    for (const m of ['openai:gpt-4o-2024-05-13', 'openai:gpt-99', 'nvidia:meta/llama-4', 'gemini:gemini-2.5-flash-preview-05-20', 'groq:llama-3.3-70b-versatile'])
      expect(costOf(m, { promptTokens: 1000, completionTokens: 1000 })).toEqual({ usd: null, exact: false, source: 'unknown' })
  })

  it('a cost the provider reports (OpenRouter usage.cost) is used as is and marked exact', () => {
    expect(costOf('openrouter:anthropic/claude-sonnet-4.5', { promptTokens: 5000, completionTokens: 100, reportedCost: 0.0123 })).toEqual({ usd: 0.0123, exact: true, source: 'provider' })
  })

  it('Dahl: $0.02 per 1M tokens on all tokens; local models cost nothing', () => {
    close(costOf('dahl:deepseek-ai/DeepSeek-V4-Flash-0731', { promptTokens: 900_000, completionTokens: 100_000 }).usd, 0.02)
    expect(costOf('ollama:llama3:8b', { promptTokens: 9e6, completionTokens: 9e6 })).toEqual({ usd: 0, exact: true, source: 'local' })
    expect(costOf('lmstudio:qwen', { promptTokens: 1, completionTokens: 1 }).usd).toBe(0)
  })

  it('time-limited prices apply only in their period; a promotion with no announced follow-up becomes unknown', () => {
    expect(findPrice('openai:gpt-5.6-sol', '2026-11-30')?.input).toBe(4)
    expect(findPrice('openai:gpt-5.6-sol', '2026-12-01')).toBeUndefined()
    expect(findPrice('gemini:gemini-4-argon', '2026-11-08')?.input).toBe(2)
    expect(findPrice('gemini:gemini-4-argon', '2026-12-01')?.input).toBe(4)
  })

  it('input-only estimate for budget checks', () => {
    close(inputCostOf('openai:gpt-4.1', 500_000, '2026-11-08'), 1)
    expect(inputCostOf('nvidia:x', 500_000)).toBeNull()
  })

  it('every price row names its source and the date it was checked', () => {
    const rows = priceRows()
    expect(rows.length).toBeGreaterThan(40)
    for (const r of rows) {
      expect(r.source).toBeTruthy()
      expect(r.checked).toBe(PRICES_CHECKED)
    }
    expect(rows[0]).toMatchObject({ provider: 'dahl', input: 0.02 })
  })
})

describe('tallies and formatting', () => {
  it('adds requests, keeps unknown prices out of the total and marks estimates', () => {
    const t = emptyTally()
    addToTally(t, { promptTokens: 1000, completionTokens: 10, cachedTokens: 500 }, { usd: 0.01, exact: false, source: 'table' })
    addToTally(t, { promptTokens: 1000, completionTokens: 10 }, { usd: null, exact: false, source: 'unknown' })
    expect(t).toMatchObject({ usd: 0.01, requests: 2, unknown: 1, estimated: true, inputTokens: 2000, cachedTokens: 500 })
    expect(formatUsd(t)).toBe('~$0.010+')
    expect(mergeTally(emptyTally(), t).requests).toBe(2)
  })

  it('formats small, exact and unknown amounts', () => {
    expect(formatUsd({ usd: 0.0004, requests: 1, unknown: 0, estimated: false })).toBe('<$0.001')
    expect(formatUsd({ usd: 1.234, requests: 1, unknown: 0, estimated: false })).toBe('$1.23')
    expect(formatUsd({ usd: 0, requests: 2, unknown: 2, estimated: false })).toBe('unknown')
  })
})

describe('usage fields from providers', () => {
  it('reads cached tokens and OpenRouter cost from OpenAI-style usage', () => {
    expect(readUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 64 }, cost: 0.002 })).toEqual({ prompt_tokens: 100, completion_tokens: 5, cached_tokens: 64, cost: 0.002 })
    expect(readUsage(null)).toBeNull()
  })

  it('Anthropic: cache reads and writes are added back into prompt tokens and kept apart', () => {
    const start = readAnthropicUsage({ input_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 200, output_tokens: 1 })
    expect(start).toEqual({ prompt_tokens: 5300, cached_tokens: 5000, cache_write_tokens: 200, completion_tokens: 1 })
    expect(readAnthropicUsage({ output_tokens: 50 }, start)).toEqual({ ...start, completion_tokens: 50 })
  })

  it('falls back to local estimates when the provider reports nothing', () => {
    expect(usageCounts(null, { prompt: 40, completion: 2 })).toMatchObject({ promptTokens: 40, completionTokens: 2, estimatedTokens: true })
  })
})

describe('Anthropic prompt caching', () => {
  it('marks the last tool, the system prompt and the last message, without changing saved provider blocks', () => {
    const saved = [{ type: 'text', text: 'hello' }, { type: 'thinking', thinking: 't', signature: 's' }]
    const body = {
      system: 'You are Dahl.',
      tools: [{ name: 'a' }, { name: 'b' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }, { role: 'assistant', content: saved }]
    }
    expect(addCacheBreakpoints(body)).toBe(3)
    expect(body.tools[1]).toEqual({ name: 'b', cache_control: { type: 'ephemeral' } })
    expect(body.tools[0]).toEqual({ name: 'a' })
    expect(body.system).toEqual([{ type: 'text', text: 'You are Dahl.', cache_control: { type: 'ephemeral' } }])
    // a thinking block cannot carry cache_control: the marker goes on the nearest block before it
    expect((body.messages[1].content as unknown[])[0]).toEqual({ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } })
    expect(saved[0]).toEqual({ type: 'text', text: 'hello' })
  })

  it('sends the markers and records cache reads and writes from a real stream shape', async () => {
    let sent: any = null
    const sse = [
      { type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }
    ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body)
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as unknown as typeof fetch
    const res = await anthropicStream('k', { model: 'claude-opus-5-5', maxTokens: 100, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' }], tools: [{ type: 'function', function: { name: 'x', parameters: {} } }] }, new AbortController().signal, {}, fetchImpl)
    expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(sent.tools[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(sent.messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' })
    expect(res.usage).toEqual({ prompt_tokens: 3520, cached_tokens: 3000, cache_write_tokens: 500, completion_tokens: 7 })
    close(costOf('anthropic:claude-opus-5-5', usageCounts(res.usage, { prompt: 0, completion: 0 })).usd, (20 * 4 + 3000 * 0.2 + 500 * 5 + 7 * 20) / 1e6)
  })
})
