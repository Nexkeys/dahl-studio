/**
 * Anthropic prompt caching (https://platform.claude.com/docs/en/build-with-claude/prompt-caching): a cache_control
 * marker caches the whole prefix up to and including its block, in the order tools, system, messages. At most 4
 * markers per request; prefixes shorter than the model's minimum (512 to 4096 tokens) are simply not cached.
 * Three markers are set: the last tool (tool schemas rarely change), the system prompt, and the last message, so the
 * next step of the same task reads everything before its new tool results from the cache (reads cost 0.025x to 0.1x
 * of input, 5-minute writes 1.25x). usage reports cache_read_input_tokens and cache_creation_input_tokens.
 */
export const CACHE_MARK = { type: 'ephemeral' } as const

/** Block types that may carry cache_control (thinking blocks may not). */
const MARKABLE = new Set(['text', 'image', 'tool_use', 'tool_result', 'document'])

type Block = { type?: string; text?: string; [k: string]: unknown }

/** Mark the request body in place. Blocks shared with saved history (provider blocks) are copied, never changed. */
export function addCacheBreakpoints(body: { system?: unknown; tools?: unknown[]; messages?: { role: string; content: unknown }[] }): number {
  let marks = 0
  if (body.tools?.length) {
    const i = body.tools.length - 1
    body.tools = [...body.tools.slice(0, i), { ...(body.tools[i] as object), cache_control: CACHE_MARK }]
    marks++
  }
  if (typeof body.system === 'string' && body.system) {
    body.system = [{ type: 'text', text: body.system, cache_control: CACHE_MARK }]
    marks++
  }
  const last = body.messages?.[body.messages.length - 1]
  if (last) {
    const blocks: Block[] = typeof last.content === 'string' ? (last.content ? [{ type: 'text', text: last.content }] : []) : [...((last.content as Block[]) ?? [])]
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i]
      if (!b || !MARKABLE.has(String(b.type)) || (b.type === 'text' && !b.text)) continue
      blocks[i] = { ...b, cache_control: CACHE_MARK }
      last.content = blocks
      marks++
      break
    }
  }
  return marks
}
