import type { KeyUsageLocal } from '@shared/types'
import type { UsageCounts } from '../pricing'

/** Normalised usage on ChatResult: OpenAI-style names, all input in prompt_tokens (cache reads and writes included). */
export interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  /** input tokens read from the prompt cache */
  cached_tokens?: number
  /** input tokens written to the prompt cache */
  cache_write_tokens?: number
  /** the provider's own charge in USD (OpenRouter usage.cost) */
  cost?: number
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/**
 * Read an OpenAI-compatible usage object. Cached tokens: prompt_tokens_details.cached_tokens (OpenAI, Gemini, Groq,
 * OpenRouter) or the older top-level cached_tokens; cache writes: prompt_tokens_details.cache_write_tokens (OpenAI
 * GPT-5.6 and later); cost: usage.cost (OpenRouter, always included per https://openrouter.ai/docs/use-cases/usage-accounting).
 */
export function readUsage(raw: unknown): ChatUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, any>
  const details = (u.prompt_tokens_details ?? u.input_tokens_details ?? {}) as Record<string, unknown>
  const out: ChatUsage = {
    prompt_tokens: num(u.prompt_tokens) ?? num(u.input_tokens),
    completion_tokens: num(u.completion_tokens) ?? num(u.output_tokens),
    cached_tokens: num(details.cached_tokens) ?? num(u.cached_tokens),
    cache_write_tokens: num(details.cache_write_tokens),
    cost: num(u.cost)
  }
  for (const k of Object.keys(out) as (keyof ChatUsage)[]) if (out[k] === undefined) delete out[k]
  return out
}

/** Anthropic Messages usage: input_tokens excludes cache reads and writes, so they are added back into prompt_tokens. */
export function readAnthropicUsage(raw: unknown, prev: ChatUsage | null = null): ChatUsage {
  const u = (raw ?? {}) as Record<string, unknown>
  const input = num(u.input_tokens)
  const read = num(u.cache_read_input_tokens)
  const write = num(u.cache_creation_input_tokens)
  const out: ChatUsage = { ...(prev ?? {}) }
  if (input !== undefined || read !== undefined || write !== undefined) {
    out.cached_tokens = read ?? prev?.cached_tokens ?? 0
    out.cache_write_tokens = write ?? prev?.cache_write_tokens ?? 0
    const plain = input ?? Math.max(0, (prev?.prompt_tokens ?? 0) - (prev?.cached_tokens ?? 0) - (prev?.cache_write_tokens ?? 0))
    out.prompt_tokens = plain + out.cached_tokens + out.cache_write_tokens
  }
  const output = num(u.output_tokens)
  if (output !== undefined) out.completion_tokens = output
  return out
}

/**
 * Request fields that make a streamed reply carry its usage. OpenAI Chat Completions only sends usage in streams with
 * stream_options.include_usage; Gemini's OpenAI endpoint documents the same option. OpenRouter and Groq always send it.
 */
export function usageRequestFields(provider: string): Record<string, unknown> {
  return provider === 'openai' || provider === 'gemini' ? { stream_options: { include_usage: true } } : {}
}

/** Counts for cost and budgets: the provider's numbers when reported, otherwise local estimates (chars / 4). */
export function usageCounts(usage: ChatUsage | null | undefined, estimate: { prompt: number; completion: number }): UsageCounts & { estimatedTokens: boolean } {
  const reported = typeof usage?.prompt_tokens === 'number'
  return {
    promptTokens: reported ? usage!.prompt_tokens! : estimate.prompt,
    completionTokens: usage?.completion_tokens ?? estimate.completion,
    cachedTokens: usage?.cached_tokens ?? 0,
    cacheWriteTokens: usage?.cache_write_tokens ?? 0,
    reportedCost: usage?.cost ?? null,
    estimatedTokens: !reported
  }
}

/** Extra fields for the usage ledger and requests.jsonl (a provider-reported cost travels as costUsd + costExact). */
export function ledgerFields(usage: ChatUsage | null | undefined): Pick<KeyUsageLocal, 'cachedTokens' | 'cacheWriteTokens' | 'costUsd' | 'costExact'> {
  return {
    ...(usage?.cached_tokens ? { cachedTokens: usage.cached_tokens } : {}),
    ...(usage?.cache_write_tokens ? { cacheWriteTokens: usage.cache_write_tokens } : {}),
    ...(typeof usage?.cost === 'number' ? { costUsd: usage.cost, costExact: true } : {})
  }
}
