import type { ChatMessage, ContentPart, ToolCall } from '@shared/types'
import { classifyHttpError, DahlError, ThinkSplitter, type ChatRequest, type ChatResult, type FetchLike, type StreamCallbacks } from '../dahl/client'
import { extractContentToolCalls, toolsAsPrompt } from './quirks'

/**
 * Ollama through its native /api/chat, not the OpenAI-compatible /v1. The /v1 endpoint cannot set the context size,
 * and Ollama's default is 4096 tokens on typical laptops, so it silently cuts the start of an agent prompt (the system
 * prompt and tool list alone are several thousand tokens). /api/chat takes options.num_ctx per request.
 * Docs: https://github.com/ollama/ollama/blob/main/docs/api.md (NDJSON stream, done: true on the last line).
 */
export const OLLAMA_CTX_CAP = 32768
const CONNECT_TIMEOUT_MS = 300_000 // the first request loads the model into memory, which can take minutes
const IDLE_TIMEOUT_MS = 180_000

/** Context to ask for: the model's maximum, capped at 32k (more needs more memory than most PCs have). */
export function ollamaNumCtx(modelMax?: number): number {
  return Math.min(modelMax && modelMax > 0 ? modelMax : OLLAMA_CTX_CAP, OLLAMA_CTX_CAP)
}

function text(content: ChatMessage['content'], vision: boolean, images: string[]): string {
  if (content === null) return ''
  if (typeof content === 'string') return content
  return content
    .map((p: ContentPart) => {
      if (p.type === 'text') return p.text
      if (vision) {
        images.push(p.data)
        return ''
      }
      return `[Image "${p.name ?? 'image'}" attached, but the selected model does not accept images. Use the analyze_image tool to get a text breakdown.]`
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Internal history to Ollama messages. With native tools, tool calls carry arguments as objects and results are "tool"
 * messages; without (a model lacking the tools capability), both become plain text the model can follow.
 */
export function toOllamaMessages(messages: ChatMessage[], vision: boolean, nativeTools: boolean): Record<string, unknown>[] {
  const names = new Map<string, string>()
  return messages.map((m) => {
    const images: string[] = []
    let content = text(m.content, vision, images)
    const out: Record<string, unknown> = { role: m.role }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      for (const tc of m.tool_calls) names.set(tc.id, tc.function.name)
      if (nativeTools) out.tool_calls = m.tool_calls.map((tc) => ({ function: { name: tc.function.name, arguments: parseArgs(tc.function.arguments) } }))
      else content = [content, ...m.tool_calls.map((tc) => `<tool_call>${JSON.stringify({ name: tc.function.name, arguments: parseArgs(tc.function.arguments) })}</tool_call>`)].filter(Boolean).join('\n')
    }
    if (m.role === 'tool') {
      const name = names.get(m.tool_call_id ?? '') ?? m.name ?? 'tool'
      if (nativeTools) out.tool_name = name
      else {
        out.role = 'user'
        content = `Result of the ${name} tool call:\n${content}`
      }
    }
    out.content = content
    if (images.length) out.images = images
    return out
  })
}

function parseArgs(s: string): unknown {
  try {
    return JSON.parse(s || '{}')
  } catch {
    return {}
  }
}

export interface OllamaRequest extends ChatRequest {
  baseUrl: string
  numCtx: number
  /** the model has the tools capability; otherwise tools are described in the system prompt and parsed from the reply */
  nativeTools: boolean
  /** think parameter for models with the thinking capability (true, or "low" | "medium" | "high" for gpt-oss) */
  think?: boolean | string
}

export async function ollamaStream(req: OllamaRequest, signal: AbortSignal, cb: StreamCallbacks = {}, fetchImpl: FetchLike = fetch): Promise<ChatResult> {
  const tools = req.tools?.length ? req.tools : undefined
  const messages = toOllamaMessages(req.messages, !!req.vision, req.nativeTools)
  if (tools && !req.nativeTools) {
    const sys = messages.find((m) => m.role === 'system')
    if (sys) sys.content = `${sys.content}\n\n${toolsAsPrompt(tools)}`
    else messages.unshift({ role: 'system', content: toolsAsPrompt(tools) })
  }
  const options: Record<string, unknown> = { num_ctx: req.numCtx }
  if (req.temperature !== undefined) options.temperature = req.temperature
  const body: Record<string, unknown> = { model: req.model, messages, stream: true, options }
  if (tools && req.nativeTools) body.tools = tools
  if (req.think !== undefined) body.think = req.think

  const ctrl = new AbortController()
  let timedOut = false
  const onAbort = (): void => ctrl.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let timer = setTimeout(() => ((timedOut = true), ctrl.abort()), CONNECT_TIMEOUT_MS)
  const bump = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => ((timedOut = true), ctrl.abort()), IDLE_TIMEOUT_MS)
  }
  const fail = (e: unknown): never => {
    if (signal.aborted) throw new DahlError('cancelled', 'Request cancelled')
    if (timedOut) throw new DahlError('timeout', 'Ollama did not respond in time')
    if (e instanceof DahlError) throw e
    throw new DahlError('network', `Could not reach Ollama at ${req.baseUrl}: ${(e as Error)?.message ?? String(e)}`)
  }

  try {
    let res: Response
    try {
      res = await fetchImpl(`${req.baseUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
    } catch (e) {
      return fail(e)
    }
    if (!res.ok) throw classifyHttpError(res.status, await res.text())
    bump()
    const result: ChatResult = { content: '', reasoning: '', toolCalls: [], finishReason: null, usage: null }
    const calls: ToolCall[] = []
    const think = new ThinkSplitter()
    const onText = (t: string): void => void ((result.content += t), cb.onDelta?.(t))
    const onThink = (t: string): void => void ((result.reasoning += t), cb.onReasoning?.(t))
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let first = true
    let done = false
    const line = (raw: string): void => {
      if (!raw.trim()) return
      let j: any
      try {
        j = JSON.parse(raw)
      } catch {
        return
      }
      if (j.error) throw new DahlError(/not found/i.test(String(j.error)) ? 'model_unavailable' : 'server', `Ollama: ${String(j.error).slice(0, 400)}`)
      const msg = j.message ?? {}
      if (typeof msg.thinking === 'string' && msg.thinking) onThink(msg.thinking)
      if (typeof msg.content === 'string' && msg.content) think.push(msg.content, onText, onThink)
      for (const tc of msg.tool_calls ?? []) {
        const name = tc?.function?.name
        if (!name) continue
        const args = tc.function.arguments
        calls.push({ id: tc.id || `call_${calls.length}_${Date.now()}`, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) } })
      }
      if (j.done) {
        done = true
        result.finishReason = j.done_reason === 'length' ? 'length' : 'stop'
        result.usage = { prompt_tokens: j.prompt_eval_count, completion_tokens: j.eval_count }
      }
    }
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
      buf += dec.decode(chunk.value, { stream: true })
      let nl: number
      while (!done && (nl = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        line(raw)
      }
    }
    if (!done) line(buf)
    // like the SSE client: a stream without its final done line was cut, not finished
    if (!done) throw new DahlError('network', 'The connection closed before the reply finished (the stream ended early).')
    result.toolCalls = calls
    if (!calls.length && tools && !req.nativeTools) {
      const parsed = extractContentToolCalls(result.content, tools)
      result.content = parsed.content
      result.toolCalls = parsed.toolCalls
    }
    if (result.toolCalls.length) result.finishReason = 'tool_calls'
    return result
  } catch (e) {
    return fail(e)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
