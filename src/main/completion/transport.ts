import { lineBefore } from '@shared/completion'
import { classifyHttpError, DahlError, type FetchLike } from '../dahl/client'
import type { BuiltPrompt, Strategy } from './prompt'

// Sending a completion prompt: FIM endpoints over plain HTTP, chat models through the model registry (see service.ts).

export interface Endpoint {
  /** OpenAI-style base URL ending in /v1 */
  base: string
  key: string | null
}

/** Output length and stop sequences for a chat request, under each API's own names. */
export function chatParams(provider: string, id: string, p: Pick<BuiltPrompt, 'maxTokens' | 'stop' | 'temperature'>): { extra: Record<string, unknown>; temperature?: number } {
  if (provider === 'anthropic') return { extra: { max_tokens: p.maxTokens, stop_sequences: p.stop.filter((s) => s.trim()) }, temperature: p.temperature }
  // OpenAI reasoning models reject temperature and stop, and spend output tokens on reasoning first
  if (provider === 'openai' && /^(o\d|gpt-5|gpt-6)/i.test(id)) return { extra: { max_completion_tokens: Math.max(1024, p.maxTokens) } }
  if (provider === 'openai') return { extra: { max_completion_tokens: p.maxTokens, stop: p.stop }, temperature: p.temperature }
  return { extra: { max_tokens: p.maxTokens, stop: p.stop }, temperature: p.temperature }
}

/** POST a FIM request: Codestral's /fim/completions, or /completions (with suffix for Ollama, FIM tokens in the prompt otherwise). */
export async function fimRequest(fetchImpl: FetchLike, ep: Endpoint, strategy: Strategy, modelId: string, p: BuiltPrompt, signal: AbortSignal): Promise<string> {
  const base = ep.base.replace(/\/$/, '')
  const url = strategy.kind === 'mistral-fim' ? `${base}/fim/completions` : `${base}/completions`
  const body: Record<string, unknown> = { model: modelId, prompt: p.prompt ?? '', max_tokens: p.maxTokens, temperature: p.temperature, stream: false }
  if (strategy.kind !== 'raw-fim') body.suffix = p.suffix
  if (p.stop.length) body.stop = p.stop
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ep.key ? { Authorization: `Bearer ${ep.key}` } : {}) },
      body: JSON.stringify(body),
      signal
    })
  } catch (e) {
    if (signal.aborted) throw new DahlError('cancelled', 'Request cancelled')
    throw new DahlError('network', `Could not reach ${new URL(url).host}: ${(e as Error).message}`)
  }
  const text = await res.text()
  if (!res.ok) throw classifyHttpError(res.status, text, res.headers.get('retry-after'))
  let j: { choices?: { text?: string; message?: { content?: string } }[] }
  try {
    j = JSON.parse(text)
  } catch {
    throw new DahlError('bad_request', `Unexpected answer from ${new URL(url).host}`)
  }
  const c = j.choices?.[0]
  return String(c?.text ?? c?.message?.content ?? '')
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new DahlError('cancelled', 'Request cancelled'))), { once: true })
  })
}

/**
 * Smoke and dev runs only (model key "fake:..."): answers like a chat model would, with tags and the closing brace
 * repeated, so the whole path (prompt, cleaning, ghost text, Tab) can be checked without an API key.
 */
export async function fakeCompletion(p: BuiltPrompt, signal: AbortSignal): Promise<string> {
  await sleep(150, signal)
  const line = lineBefore(p.prefix)
  const indent = /^[ \t]*/.exec(line)![0]
  if (/\{\s*$/.test(line)) return `<COMPLETION>\n${indent}  return a + b\n${indent}}</COMPLETION>`
  return '<COMPLETION> // suggested by the fake completion source</COMPLETION>'
}
