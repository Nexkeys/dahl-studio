import type { ChatMessage, ContentPart, ToolCall } from '@shared/types'
import { classifyHttpError, DahlError, type ChatRequest, type ChatResult, type FetchLike, type StreamCallbacks } from '../dahl/client'

/**
 * Native Anthropic Messages API adapter (https://api.anthropic.com/v1/messages).
 * Verified against Anthropic docs: x-api-key + anthropic-version headers; SSE events
 * content_block_start/delta/stop with text_delta, input_json_delta, thinking_delta, signature_delta;
 * thinking blocks must be passed back unchanged within a tool-use turn (kept in providerBlocks).
 */
export const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'
export const ANTHROPIC_VERSION = '2023-06-01'

export function anthropicHeaders(key: string): Record<string, string> {
  return { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' }
}

function partsToBlocks(content: ChatMessage['content'], vision: boolean): unknown[] {
  if (content === null) return []
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  return content.map((p: ContentPart) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : vision
        ? { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } }
        : { type: 'text', text: `[Image "${p.name ?? 'image'}" omitted: model does not accept images]` }
  )
}

/** Convert OpenAI-style history into Anthropic system + messages (tool results become user tool_result blocks). */
export function toAnthropic(messages: ChatMessage[], vision: boolean): { system: string; messages: unknown[] } {
  const system = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n')
  const out: { role: 'user' | 'assistant'; content: unknown[] }[] = []
  const push = (role: 'user' | 'assistant', blocks: unknown[]): void => {
    if (!blocks.length) return
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else out.push({ role, content: blocks })
  }
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') push('user', partsToBlocks(m.content, vision))
    else if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content || '(empty)' : partsToBlocks(m.content, vision) }])
    else if (m.role === 'assistant') {
      if (m.providerBlocks?.length) push('assistant', m.providerBlocks)
      else {
        const blocks: unknown[] = partsToBlocks(m.content, false)
        for (const tc of m.tool_calls ?? []) {
          let input: unknown = {}
          try {
            input = JSON.parse(tc.function.arguments || '{}')
          } catch {
            input = {}
          }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
        }
        push('assistant', blocks.length ? blocks : [{ type: 'text', text: '(no content)' }])
      }
    }
  }
  // Anthropic requires tool_result blocks to come first in a user message
  for (const msg of out) {
    if (msg.role === 'user') {
      const isResult = (b: unknown): boolean => (b as { type?: string })?.type === 'tool_result'
      msg.content = [...msg.content.filter(isResult), ...msg.content.filter((b) => !isResult(b))]
    }
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: '(start)' }] })
  return { system, messages: out }
}

function toAnthropicTools(tools: unknown[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t) => {
    const f = (t as { function: { name: string; description?: string; parameters?: unknown } }).function
    return { name: f.name, description: f.description ?? '', input_schema: f.parameters ?? { type: 'object', properties: {} } }
  })
}

export async function anthropicStream(
  key: string,
  req: ChatRequest & { maxTokens: number },
  signal: AbortSignal,
  cb: StreamCallbacks = {},
  fetchImpl: FetchLike = fetch
): Promise<ChatResult> {
  const { system, messages } = toAnthropic(req.messages, !!req.vision)
  const body: Record<string, unknown> = { model: req.model, max_tokens: req.maxTokens, messages, stream: true }
  if (system) body.system = system
  const tools = toAnthropicTools(req.tools)
  if (tools) body.tools = tools
  if (req.extra) Object.assign(body, req.extra)

  let res: Response
  try {
    res = await fetchImpl(`${ANTHROPIC_BASE}/messages`, { method: 'POST', headers: anthropicHeaders(key), body: JSON.stringify(body), signal })
  } catch (e) {
    if (signal.aborted) throw new DahlError('cancelled', 'Request cancelled')
    throw new DahlError('network', `Network error: ${(e as Error).message}`)
  }
  if (!res.ok) throw classifyHttpError(res.status, await res.text(), res.headers.get('retry-after'))

  const result: ChatResult = { content: '', reasoning: '', toolCalls: [], finishReason: null, usage: null, providerBlocks: [] }
  const blocks: any[] = []
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let first = true
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (first) {
        first = false
        cb.onFirstByte?.()
      }
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        let ev: any
        try {
          ev = JSON.parse(line.slice(5).trim())
        } catch {
          continue
        }
        switch (ev.type) {
          case 'message_start':
            result.usage = { prompt_tokens: ev.message?.usage?.input_tokens, completion_tokens: ev.message?.usage?.output_tokens ?? 0 }
            break
          case 'content_block_start':
            blocks[ev.index] = { ...ev.content_block, _json: '' }
            break
          case 'content_block_delta': {
            const b = blocks[ev.index]
            const d = ev.delta
            if (d.type === 'text_delta') {
              b.text = (b.text ?? '') + d.text
              result.content += d.text
              cb.onDelta?.(d.text)
            } else if (d.type === 'thinking_delta') {
              b.thinking = (b.thinking ?? '') + d.thinking
              result.reasoning += d.thinking
              cb.onReasoning?.(d.thinking)
            } else if (d.type === 'signature_delta') b.signature = (b.signature ?? '') + d.signature
            else if (d.type === 'input_json_delta') b._json += d.partial_json
            break
          }
          case 'content_block_stop': {
            const b = blocks[ev.index]
            if (b?.type === 'tool_use') {
              try {
                b.input = b._json ? JSON.parse(b._json) : b.input ?? {}
              } catch {
                b.input = {}
                b._invalid = b._json
              }
            }
            break
          }
          case 'message_delta':
            if (ev.delta?.stop_reason) result.finishReason = ev.delta.stop_reason === 'max_tokens' ? 'length' : ev.delta.stop_reason
            if (ev.usage?.output_tokens !== undefined) result.usage = { ...(result.usage ?? {}), completion_tokens: ev.usage.output_tokens }
            break
          case 'error':
            throw classifyHttpError(ev.error?.type === 'overloaded_error' ? 529 : 500, JSON.stringify(ev))
        }
      }
    }
  } catch (e) {
    if (signal.aborted) throw new DahlError('cancelled', 'Request cancelled')
    if (e instanceof DahlError) throw e
    throw new DahlError('network', `Stream error: ${(e as Error).message}`)
  }
  const calls: ToolCall[] = []
  for (const b of blocks.filter(Boolean)) {
    const { _json, _invalid, ...clean } = b
    result.providerBlocks!.push(clean)
    if (b.type === 'tool_use') calls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: _invalid ?? JSON.stringify(b.input ?? {}) } })
  }
  result.toolCalls = calls
  return result
}
