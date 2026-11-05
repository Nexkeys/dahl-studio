import { describe, it, expect, vi } from 'vitest'
import { batchDeltas } from '../src/main/eventBatch'
import type { AgentEvent } from '../src/shared/types'

describe('delta batching in the main process', () => {
  it('merges tokens into one message per frame and never reorders other events', () => {
    vi.useFakeTimers()
    const sent: AgentEvent[] = []
    const emit = batchDeltas((e) => sent.push(e), 16)
    const ev = (e: Partial<AgentEvent>) => emit({ runId: 'r', project: 'p', ...e } as AgentEvent)
    for (const t of ['Hel', 'lo', ' wor', 'ld']) ev({ type: 'delta', delta: t })
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(20)
    expect(sent.map((e) => e.delta)).toEqual(['Hello world'])
    ev({ type: 'delta', delta: 'partial' })
    ev({ type: 'transcript', item: { id: 'i', at: '', kind: 'assistant', text: 'partial' } })
    expect(sent.slice(1).map((e) => e.type)).toEqual(['delta', 'transcript'])
    vi.useRealTimers()
  })
})
