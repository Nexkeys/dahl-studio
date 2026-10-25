import type { Attachment, ChatMessage, ContentPart, RunState, RunSummary } from '@shared/types'

export const MAX_CONTEXT_CHARS = 320_000

export function summary(r: RunState): RunSummary {
  return { id: r.id, project: r.project, objective: r.objective, status: r.status, updatedAt: r.updatedAt, mode: r.mode, changedFiles: r.changedFiles ?? [] }
}

/** Build the user message content: prompt text + attachment digests + images. */
export function buildUserContent(prompt: string, atts: Attachment[], images: Map<string, { mediaType: string; data: string }>): string | ContentPart[] {
  if (!atts.length) return prompt
  const parts: ContentPart[] = []
  const texts: string[] = [prompt]
  for (const a of atts) {
    if (a.kind === 'image' && a.data && a.mediaType) {
      images.set(a.name, { mediaType: a.mediaType, data: a.data })
      parts.push({ type: 'image', mediaType: a.mediaType, data: a.data, name: a.name })
      texts.push(`[Attached image: ${a.name}. If you cannot see images, call analyze_image with path "${a.name}".]`)
    } else if (a.text) {
      const label = a.kind === 'folder' ? 'Attached folder' : a.kind === 'selection' ? 'Attached editor selection' : 'Attached file'
      texts.push(`<attachment type="${a.kind}" name="${a.name}">\n${label}: ${a.name}\n${a.text}\n</attachment>`)
    }
  }
  return parts.length ? [{ type: 'text', text: texts.join('\n\n') }, ...parts] : texts.join('\n\n')
}

/**
 * Make stored history acceptable to the API again:
 * - tool calls with invalid (e.g. truncated) JSON arguments get valid placeholder arguments
 *   (otherwise every later request fails with "400 Unterminated string")
 * - tool calls without results (run interrupted) get a synthetic "not executed" result
 */
export function repairHistory(messages: ChatMessage[]): void {
  normalizeToolOrder(messages)
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue
    for (const tc of m.tool_calls) {
      if (!isValidJson(tc.function.arguments)) tc.function.arguments = JSON.stringify({ _invalid_arguments: true })
    }
    if (m.providerBlocks) {
      for (const b of m.providerBlocks as any[]) if (b?.type === 'tool_use' && (typeof b.input !== 'object' || b.input === null)) b.input = {}
    }
    const answered = new Set<string>()
    let j = i + 1
    while (j < messages.length && messages[j].role === 'tool') answered.add(messages[j++].tool_call_id ?? '')
    const missing = m.tool_calls.filter((tc) => !answered.has(tc.id))
    if (missing.length) {
      messages.splice(j, 0, ...missing.map((tc) => ({ role: 'tool' as const, tool_call_id: tc.id, content: 'Not executed: the task was interrupted before this action completed. Re-check state and re-propose if still needed.' })))
    }
  }
}

/**
 * Providers require tool results to come directly after the assistant message that called them.
 * Older histories could have a user/image message between results. This moves each tool result directly
 * after its call, keeps only the first result per call id, and drops results whose call no longer exists.
 */
export function normalizeToolOrder(messages: ChatMessage[]): void {
  const out: ChatMessage[] = []
  let i = 0
  while (i < messages.length) {
    const m = messages[i]
    if (m.role === 'tool') {
      i++ // orphan tool result (its assistant call was not seen): drop
      continue
    }
    out.push(m)
    i++
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue
    const ids = new Set(m.tool_calls.map((t) => t.id))
    const results = new Map<string, ChatMessage>()
    const others: ChatMessage[] = []
    // collect everything up to the next assistant message
    while (i < messages.length && messages[i].role !== 'assistant') {
      const x = messages[i]
      if (x.role === 'tool') {
        if (x.tool_call_id && ids.has(x.tool_call_id) && !results.has(x.tool_call_id)) results.set(x.tool_call_id, x)
      } else others.push(x)
      i++
    }
    for (const tc of m.tool_calls) if (results.has(tc.id)) out.push(results.get(tc.id)!)
    out.push(...others)
  }
  messages.splice(0, messages.length, ...out)
}

/** Backwards-compatible name used by older tests. */
export const closeDanglingToolCalls = repairHistory

export function isValidJson(s: string): boolean {
  try {
    JSON.parse(s || '{}')
    return true
  } catch {
    return false
  }
}

/** Keep context bounded: shrink old tool outputs and drop old images first; newest messages stay intact. */
export function compact(messages: ChatMessage[], maxChars = MAX_CONTEXT_CHARS): ChatMessage[] {
  const sizeOf = (m: ChatMessage): number => (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length) + JSON.stringify(m.tool_calls ?? '').length
  let size = messages.reduce((a, m) => a + sizeOf(m), 0)
  if (size <= maxChars) return messages
  const out = messages.map((m) => ({ ...m }))
  for (let i = 0; i < out.length - 6 && size > maxChars; i++) {
    const m = out[i]
    if (Array.isArray(m.content) && m.content.some((p) => p.type === 'image')) {
      const before = sizeOf(m)
      m.content = m.content.map((p) => (p.type === 'image' ? { type: 'text' as const, text: `[older image ${p.name ?? ''} removed to save context]` } : p))
      size -= before - sizeOf(m)
    }
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 600) {
      size -= m.content.length - 600
      m.content = m.content.slice(0, 600) + '\n[older output truncated to save context]'
    }
  }
  return out
}

export function summariseTool(name: string, args: string): string {
  try {
    const a = JSON.parse(args)
    if (name === 'delegate_agents') return `Delegated to ${(a.agents ?? []).map((x: { role: string }) => x.role).join(', ')}`
    if (a.path !== undefined) return `${name.replace(/_/g, ' ')} ${a.path || '.'}`
    if (a.command) return `run: ${a.command}`
    if (a.query) return `${name.replace(/_/g, ' ')} "${a.query}"`
    if (a.url) return `fetch ${a.url}`
  } catch {
    /* ignore */
  }
  return name.replace(/^mcp__/, '').replace(/__/g, ' / ').replace(/_/g, ' ')
}

export function mediaTypeFor(file: string): string | null {
  const ext = file.split('.').pop()?.toLowerCase() ?? ''
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' } as Record<string, string>)[ext] ?? null
}
