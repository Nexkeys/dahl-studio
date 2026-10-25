import type { ChatMessage, ContentPart, ToolCall } from '@shared/types'

/** From Dahl_API_DOCS.md. Inference under /v1, key balance at service root. */
export const DAHL_ROOT = 'https://inference.dahl.global'
export const DAHL_V1 = `${DAHL_ROOT}/v1`

/** Context windows documented in Dahl_API_DOCS.md (the /v1/models response does not include them). */
export const DAHL_DOCUMENTED_CONTEXT: Record<string, number> = {
  'MiniMaxAI/MiniMax-M2.7': 180_000,
  'deepseek-ai/DeepSeek-V4-Flash-0731': 400_000,
  'zai-org/GLM-5.3-Flash': 400_000
}

export type DahlErrorKind =
  | 'auth' // 401 / 403
  | 'exhausted' // 402
  | 'rate_key' // 429 parallel_key_limit / parallel_user_limit
  | 'rate_model' // 429 model_concurrency / generic 429
  | 'model_unavailable' // 400 "not currently offered" / 404 model
  | 'context_length' // context_length_exceeded
  | 'bad_request' // other 4xx
  | 'server' // 5xx
  | 'timeout'
  | 'network'
  | 'cancelled'

export class DahlError extends Error {
  constructor(
    public kind: DahlErrorKind,
    message: string,
    public status?: number,
    public retryAfterMs?: number
  ) {
    super(message)
    this.name = 'DahlError'
  }
}

export function classifyHttpError(status: number, bodyText: string, retryAfter?: string | null): DahlError {
  let msg = bodyText
  try {
    const j = JSON.parse(bodyText)
    msg = j?.error?.message ?? j?.message ?? j?.detail ?? (Array.isArray(j) ? j[0]?.error?.message : undefined) ?? bodyText
    if (typeof msg !== 'string') msg = JSON.stringify(msg)
  } catch {
    /* plain text body */
  }
  msg = (msg || `HTTP ${status}`).slice(0, 600)
  const lower = (bodyText + ' ' + msg).toLowerCase()
  const ra = retryAfter && !Number.isNaN(Number(retryAfter)) ? Number(retryAfter) * 1000 : undefined
  if (status === 401 || status === 403) return new DahlError('auth', `Authentication failed: ${msg}`, status)
  if (status === 402) return new DahlError('exhausted', `Key has no tokens allocated: ${msg}`, status)
  if (status === 429) {
    if (lower.includes('parallel_key_limit') || lower.includes('parallel_user_limit') || lower.includes('parallel'))
      return new DahlError('rate_key', `Too many parallel requests on this key: ${msg}`, status, ra)
    if (lower.includes('quota') || lower.includes('insufficient') || lower.includes('credit'))
      return new DahlError('exhausted', `Quota exhausted: ${msg}`, status, ra)
    return new DahlError('rate_model', `Rate limited / model at capacity: ${msg}`, status, ra)
  }
  if (lower.includes('context_length_exceeded') || lower.includes('prompt is too long') || lower.includes('maximum context'))
    return new DahlError('context_length', `Context too long: ${msg}`, status)
  if ((status === 400 && lower.includes('not currently offered')) || (status === 404 && lower.includes('model')) || lower.includes('no longer available') || lower.includes('has been deprecated'))
    return new DahlError('model_unavailable', msg, status)
  if (status >= 500 || status === 529) return new DahlError('server', `Service error (${status}): ${msg}`, status, ra)
  return new DahlError('bad_request', `Request rejected (${status}): ${msg}`, status)
}

export type FetchLike = typeof fetch

export async function listModels(fetchImpl: FetchLike = fetch, signal?: AbortSignal): Promise<{ id: string; ownedBy?: string }[]> {
  let res: Response
  try {
    res = await fetchImpl(`${DAHL_V1}/models`, { signal: signal ?? AbortSignal.timeout(20000) })
  } catch (e) {
    throw new DahlError('network', `Could not reach Dahl: ${(e as Error).message}`)
  }
  if (!res.ok) throw classifyHttpError(res.status, await res.text(), res.headers.get('retry-after'))
  const json = (await res.json()) as { data?: { id: string; owned_by?: string }[] }
  return (json.data ?? []).map((m) => ({ id: String(m.id), ownedBy: m.owned_by }))
}

/** GET /tokens/current — remaining tokens on that key (provider-reported). */
export async function getKeyBalance(key: string, fetchImpl: FetchLike = fetch): Promise<{ status: number; body: unknown }> {
  let res: Response
  try {
    res = await fetchImpl(`${DAHL_ROOT}/tokens/current`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) })
  } catch (e) {
    throw new DahlError('network', `Could not reach Dahl: ${(e as Error).message}`)
  }
  const text = await res.text()
  if (!res.ok) throw classifyHttpError(res.status, text, res.headers.get('retry-after'))
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}

/** Find the most plausible "remaining tokens" number in a balance response. */
export function extractRemaining(body: unknown): number | null {
  if (typeof body === 'number') return body
  if (typeof body === 'string' && /^\d+$/.test(body.trim())) return Number(body.trim())
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>
    for (const k of ['available_tokens', 'remaining_tokens', 'tokens', 'remaining', 'balance', 'available']) {
      if (typeof o[k] === 'number') return o[k] as number
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') {
        const n = extractRemaining(v)
        if (n !== null) return n
      }
    }
  }
  return null
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: unknown[]
  temperature?: number
  /** provider-specific body fields (reasoning_effort, chat_template_kwargs, ...) */
  extra?: Record<string, unknown>
  /** whether image parts may be sent; otherwise they are replaced by a text note */
  vision?: boolean
}

export interface ChatResult {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  finishReason: string | null
  usage: { prompt_tokens?: number; completion_tokens?: number } | null
  providerBlocks?: unknown[]
}

export interface StreamCallbacks {
  onDelta?: (text: string) => void
  onReasoning?: (text: string) => void
  onFirstByte?: () => void
}

export interface EndpointOptions {
  baseUrl?: string
  headers?: Record<string, string>
}

const CONNECT_TIMEOUT_MS = 120_000
const IDLE_TIMEOUT_MS = 180_000

/** Convert internal messages to OpenAI chat format (images become image_url data URLs or a text note). */
export function toOpenAIMessages(messages: ChatMessage[], vision: boolean): unknown[] {
  return messages.map((m) => {
    const out: Record<string, unknown> = { role: m.role }
    if (Array.isArray(m.content)) {
      const parts = m.content.map((p: ContentPart) =>
        p.type === 'text'
          ? { type: 'text', text: p.text }
          : vision
            ? { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } }
            : { type: 'text', text: `[Image "${p.name ?? 'image'}" attached, but the selected model does not accept images. Use the analyze_image tool to get a text breakdown.]` }
      )
      out.content = parts.every((p) => p.type === 'text') ? parts.map((p) => (p as { text: string }).text).join('\n\n') : parts
    } else out.content = m.content
    if (m.tool_calls?.length) out.tool_calls = m.tool_calls
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id
    if (m.name) out.name = m.name
    return out
  })
}

/** Splits inline <think>...</think> blocks (used by some open models) out of streamed content. */
class ThinkSplitter {
  private inThink = false
  private buf = ''
  push(s: string, onText: (t: string) => void, onThink: (t: string) => void): void {
    this.buf += s
    while (this.buf) {
      const tag = this.inThink ? '</think>' : '<think>'
      const i = this.buf.indexOf(tag)
      if (i >= 0) {
        const chunk = this.buf.slice(0, i)
        if (chunk) (this.inThink ? onThink : onText)(chunk)
        this.buf = this.buf.slice(i + tag.length)
        this.inThink = !this.inThink
        continue
      }
      // keep a possible partial tag at the end
      const keep = Math.min(this.buf.length, tag.length - 1)
      let cut = this.buf.length
      for (let k = keep; k > 0; k--) if (tag.startsWith(this.buf.slice(-k))) { cut = this.buf.length - k; break }
      const chunk = this.buf.slice(0, cut)
      if (chunk) (this.inThink ? onThink : onText)(chunk)
      this.buf = this.buf.slice(cut)
      break
    }
  }
}

/**
 * POST {baseUrl}/chat/completions with stream:true (OpenAI-compatible; used for Dahl, OpenAI, Gemini, NVIDIA).
 * Parses SSE ("data: {...}" lines, ending "data: [DONE]"), accumulates text, tool_call deltas by index and
 * reasoning (reasoning_content / reasoning / inline <think>).
 */
export async function streamChat(
  key: string,
  req: ChatRequest,
  signal: AbortSignal,
  cb: StreamCallbacks = {},
  fetchImpl: FetchLike = fetch,
  opts: EndpointOptions = {}
): Promise<ChatResult> {
  const base = (opts.baseUrl ?? DAHL_V1).replace(/\/$/, '')
  const ctrl = new AbortController()
  let timedOut = false
  const onAbort = (): void => ctrl.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, CONNECT_TIMEOUT_MS)
  const bump = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, IDLE_TIMEOUT_MS)
  }

  const body: Record<string, unknown> = { model: req.model, messages: toOpenAIMessages(req.messages, !!req.vision), stream: true }
  if (req.tools && req.tools.length) body.tools = req.tools
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.extra) Object.assign(body, req.extra)

  const fail = (e: unknown): never => {
    if (signal.aborted) throw new DahlError('cancelled', 'Request cancelled')
    if (timedOut) throw new DahlError('timeout', 'The model did not respond in time')
    if (e instanceof DahlError) throw e
    throw new DahlError('network', `Network error: ${(e as Error)?.message ?? String(e)}`)
  }

  try {
    let res: Response
    try {
      res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(opts.headers ?? {}) },
        body: JSON.stringify(body),
        signal: ctrl.signal
      })
    } catch (e) {
      return fail(e)
    }
    if (!res.ok) throw classifyHttpError(res.status, await res.text(), res.headers.get('retry-after'))
    bump()

    const result: ChatResult = { content: '', reasoning: '', toolCalls: [], finishReason: null, usage: null }
    const calls: { id: string; name: string; args: string }[] = []
    const ctype = res.headers.get('content-type') ?? ''
    const think = new ThinkSplitter()
    const onText = (t: string): void => {
      result.content += t
      cb.onDelta?.(t)
    }
    const onThink = (t: string): void => {
      result.reasoning += t
      cb.onReasoning?.(t)
    }

    // Some gateways ignore stream:true and return plain JSON; handle that too.
    if (ctype.includes('application/json')) {
      const j = (await res.json()) as any
      const msg = j?.choices?.[0]?.message ?? {}
      if (msg.reasoning_content || msg.reasoning) onThink(msg.reasoning_content ?? msg.reasoning)
      think.push(msg.content ?? '', onText, onThink)
      result.toolCalls = (msg.tool_calls ?? []) as ToolCall[]
      result.finishReason = j?.choices?.[0]?.finish_reason ?? null
      result.usage = j?.usage ?? null
      return result
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let first = true
    let done = false
    while (!done) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (e) {
        return fail(e)
      }
      if (chunk.done) break
      bump()
      if (first) {
        first = false
        cb.onFirstByte?.()
      }
      buf += decoder.decode(chunk.value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          done = true
          break
        }
        let j: any
        try {
          j = JSON.parse(data)
        } catch {
          continue
        }
        if (j.error) throw classifyHttpError(Number(j.error.code) || 500, JSON.stringify(j))
        if (j.usage) result.usage = j.usage
        const choice = j.choices?.[0]
        if (!choice) continue
        const d = choice.delta ?? {}
        const r = d.reasoning_content ?? d.reasoning
        if (typeof r === 'string' && r) onThink(r)
        if (typeof d.content === 'string' && d.content) think.push(d.content, onText, onThink)
        for (const tc of d.tool_calls ?? []) {
          const i = typeof tc.index === 'number' ? tc.index : calls.length
          calls[i] ??= { id: '', name: '', args: '' }
          if (tc.id) calls[i].id = tc.id
          if (tc.function?.name) calls[i].name += tc.function.name
          if (tc.function?.arguments) calls[i].args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments)
        }
        if (choice.finish_reason) result.finishReason = choice.finish_reason
      }
    }
    result.toolCalls = calls
      .filter((c) => c && c.name)
      .map((c, i) => ({ id: c.id || `call_${i}_${Date.now()}`, type: 'function', function: { name: c.name, arguments: c.args || '{}' } }))
    return result
  } catch (e) {
    return fail(e)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

/** Rough local token estimate (chars / 4). Always labelled as an estimate in the UI. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
