import type { ToolCall } from '@shared/types'

/**
 * Request and response quirks of individual OpenAI-compatible providers. Each shaper edits the request body last,
 * after the reasoning parameters (streamChat EndpointOptions.shape), so the retry that drops reasoning keeps them.
 */

/** OpenRouter asks apps to identify themselves; it shows the app name on its activity pages. */
export const OPENROUTER_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/Nexkeys/dahl-studio',
  'X-OpenRouter-Title': 'Dahl Studio',
  'X-Title': 'Dahl Studio'
}

/**
 * OpenRouter: with tools, only route to upstream providers that support every parameter sent. Without this it may pick
 * a provider that silently drops the tools, and the agent gets a plain-text answer instead of tool calls.
 */
export function shapeOpenRouter(body: Record<string, unknown>): void {
  if (Array.isArray(body.tools) && body.tools.length) body.provider = { ...((body.provider as object) ?? {}), require_parameters: true }
}

/**
 * Groq (https://console.groq.com/docs/openai): max_completion_tokens replaces max_tokens, n must be 1 and logprobs,
 * logit_bias and top_logprobs are not supported. gpt-oss models get parallel_tool_calls: false, because parallel calls
 * from them often come back malformed (tool_use_failed).
 */
export function shapeGroq(model: string): (body: Record<string, unknown>) => void {
  return (body) => {
    if (body.max_tokens !== undefined) {
      body.max_completion_tokens ??= body.max_tokens
      delete body.max_tokens
    }
    if (body.n !== undefined) body.n = 1
    for (const k of ['logprobs', 'logit_bias', 'top_logprobs']) delete body[k]
    if (/gpt-oss/i.test(model) && Array.isArray(body.tools) && body.tools.length) body.parallel_tool_calls = false
  }
}

// ---------------- tool calls written into the reply text ----------------

const MARKERS: [RegExp, RegExp][] = [
  [/\[TOOL_REQUEST\]/g, /\[END_TOOL_REQUEST\]/], // LM Studio's default tool format
  [/<tool_call>/g, /<\/tool_call>/], // Hermes / Qwen
  [/<\|tool_call\|>|<function_call>/g, /<\|\/tool_call\|>|<\/function_call>/]
]

function toolNames(tools: unknown[] | undefined): Set<string> {
  return new Set((tools ?? []).map((t) => (t as { function?: { name?: string } })?.function?.name).filter((n): n is string => !!n))
}

/** The JSON object or array that starts at text[start] (balanced braces, strings respected), or null. */
function jsonAt(text: string, start: number): { value: unknown; end: number } | null {
  const open = text[start]
  if (open !== '{' && open !== '[') return null
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** {name, arguments} / {name, parameters} / {tool, args} / {function: {name, arguments}} -> a call, if the name is a real tool. */
function asCall(v: unknown, names: Set<string>): { name: string; args: string } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const f = (o.function && typeof o.function === 'object' ? o.function : o) as Record<string, unknown>
  const name = f.name ?? o.tool ?? o.tool_name
  if (typeof name !== 'string' || !names.has(name)) return null
  const raw = f.arguments ?? f.parameters ?? o.args ?? o.input ?? {}
  return { name, args: typeof raw === 'string' ? raw : JSON.stringify(raw) }
}

/**
 * Models without native tool support (LM Studio models without "trained for tool use", Ollama models without the tools
 * capability) often write the call into the reply text: as LM Studio's [TOOL_REQUEST] block, a <tool_call> tag, a
 * ```json fence or bare JSON. This finds such calls, keeps only ones naming a tool that was offered, and returns them
 * as real tool calls with the call text removed from the content. A reply that merely shows JSON is left alone.
 */
export function extractContentToolCalls(content: string, tools: unknown[] | undefined): { content: string; toolCalls: ToolCall[] } {
  const names = toolNames(tools)
  if (!names.size || !content.trim()) return { content, toolCalls: [] }
  const found: { name: string; args: string }[] = []
  const cut: [number, number][] = []
  const take = (v: unknown, from: number, to: number): boolean => {
    const list = (Array.isArray(v) ? v : [v]).map((x) => asCall(x, names))
    if (!list.length || list.some((c) => !c)) return false
    found.push(...(list as { name: string; args: string }[]))
    cut.push([from, to])
    return true
  }
  for (const [open, close] of MARKERS) {
    for (const m of content.matchAll(open)) {
      const at = m.index! + m[0].length
      const startJson = content.slice(at).search(/\S/)
      if (startJson < 0) continue
      const j = jsonAt(content, at + startJson)
      if (!j) continue
      const tail = content.slice(j.end).match(close)
      const end = tail && content.slice(j.end, j.end + tail.index!).trim() === '' ? j.end + tail.index! + tail[0].length : j.end
      take(j.value, m.index!, end)
    }
  }
  if (!found.length) {
    // ```json fences, then a reply that is nothing but a JSON call
    for (const m of content.matchAll(/```(?:json|tool_call)?\s*\n?([\s\S]*?)```/g)) {
      const inner = m[1].trim()
      const j = jsonAt(inner, 0)
      if (j && j.end === inner.length) take(j.value, m.index!, m.index! + m[0].length)
    }
    const trimmed = content.trim()
    if (!found.length && /^[[{]/.test(trimmed)) {
      const j = jsonAt(trimmed, 0)
      if (j && j.end === trimmed.length) take(j.value, 0, content.length)
    }
  }
  if (!found.length) return { content, toolCalls: [] }
  let rest = content
  for (const [a, b] of [...cut].sort((x, y) => y[0] - x[0])) rest = rest.slice(0, a) + rest.slice(b)
  const stamp = Date.now()
  return {
    content: rest.trim(),
    toolCalls: found.map((c, i) => ({ id: `call_text_${i}_${stamp}`, type: 'function', function: { name: c.name, arguments: c.args } }))
  }
}

/** Tool instructions for a model that cannot take tools natively; its reply is parsed with extractContentToolCalls. */
export function toolsAsPrompt(tools: unknown[]): string {
  const lines = tools.map((t) => {
    const f = (t as { function: { name: string; description?: string; parameters?: unknown } }).function
    return `- ${f.name}: ${(f.description ?? '').slice(0, 400)}\n  parameters: ${JSON.stringify(f.parameters ?? {})}`
  })
  return [
    'You can call tools. To call one, reply with only this block and nothing else:',
    '<tool_call>{"name": "<tool name>", "arguments": {<arguments as JSON>}}</tool_call>',
    'Several calls may follow each other. The results come back in the next message. Available tools:',
    ...lines
  ].join('\n')
}
