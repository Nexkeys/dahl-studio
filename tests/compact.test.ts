import { describe, it, expect } from 'vitest'
import { compact } from '../src/main/agent/history'
import type { ChatMessage } from '../src/shared/types'

const big = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i} of a large file`).join('\n')

function history(steps: number): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'user', content: 'Build the app' }]
  for (let i = 0; i < steps; i++) {
    out.push({ role: 'assistant', content: null, tool_calls: [{ id: `w${i}`, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: `f${i}.ts`, content: big(400) }) } }] })
    out.push({ role: 'tool', tool_call_id: `w${i}`, content: `Wrote f${i}.ts\n${big(300)}` })
  }
  return out
}
const size = (ms: ChatMessage[]): number => ms.reduce((a, m) => a + JSON.stringify(m).length, 0)

describe('history compaction', () => {
  it('shrinks old file contents and tool output even when under the budget, and keeps the newest steps intact', () => {
    const h = history(20)
    const c = compact(h)
    // 20 steps of ~18k chars each: the newest 6 steps (12 messages) stay verbatim, the older 14 shrink to a few hundred chars
    expect(size(c)).toBeLessThan(size(h) * 0.45)
    const lastCall = c.at(-2)!.tool_calls![0].function.arguments
    expect(JSON.parse(lastCall).content).toBe(big(400)) // newest write untouched
    const firstCall = JSON.parse(c[1].tool_calls![0].function.arguments)
    expect(firstCall.path).toBe('f0.ts')
    expect(firstCall.content).toMatch(/^\[400 lines, \d+ chars; already applied\]$/)
    expect(c[2].content).toMatch(/older output shortened/)
    expect(h[1].tool_calls![0].function.arguments).toContain('line 399') // the stored history itself is not modified
  })

  it('never changes messages that carry provider blocks', () => {
    const h = history(20)
    h[1] = { ...h[1], providerBlocks: [{ type: 'thinking', thinking: 'x', signature: 'sig' }] }
    expect(compact(h)[1].tool_calls![0].function.arguments).toBe(h[1].tool_calls![0].function.arguments)
  })

  it('leaves a short conversation exactly as it is', () => {
    const h: ChatMessage[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]
    expect(compact(h)).toEqual(h)
  })
})
