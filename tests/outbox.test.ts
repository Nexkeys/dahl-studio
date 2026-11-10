import { describe, it, expect } from 'vitest'
import { joinOut, seenSteers, sendHow, settleOut, visibleOut, type OutMsg } from '../src/shared/outbox'

const steer = (id: string, runId = 'r1'): OutMsg => ({ id, runId, text: `steer ${id}`, kind: 'steer' })
const queued = (id: string, runId = 'r1', urgent = false): OutMsg => ({ id, runId, text: `queued ${id}`, kind: 'queued', urgent })

describe('messages typed while Dahl works', () => {
  it('maps keys: Enter tells Dahl now, Alt+Enter waits, Ctrl+Enter stops and sends', () => {
    expect(sendHow({ altKey: false, ctrlKey: false, metaKey: false })).toBe('steer')
    expect(sendHow({ altKey: true, ctrlKey: false, metaKey: false })).toBe('queue')
    expect(sendHow({ altKey: false, ctrlKey: true, metaKey: false })).toBe('stop')
    expect(sendHow({ altKey: false, ctrlKey: false, metaKey: true })).toBe('stop')
  })

  it('hides a steer once the task has read it, and shows only this run', () => {
    const items = [steer('a'), steer('b'), queued('c'), queued('d', 'r2')]
    const seen = seenSteers([{ steerId: 'a' }, {}])
    expect(visibleOut(items, 'r1', seen).map((m) => m.id)).toEqual(['b', 'c'])
    expect(visibleOut(items, null, seen)).toEqual([])
  })

  it('sends everything left, as one turn, when the task completes', () => {
    const r = settleOut([steer('a'), steer('b'), queued('c'), queued('x', 'r2')], 'r1', new Set(['a']), 'completed')
    expect(r.send.map((m) => m.id)).toEqual(['b', 'c'])
    expect(r.items.map((m) => m.id)).toEqual(['x'])
    expect(joinOut(r.send).text).toBe('steer b\n\nqueued c')
  })

  it('keeps unread messages on screen after a pause, failure or plain cancel', () => {
    for (const status of ['paused', 'failed', 'cancelled'] as const) {
      const r = settleOut([steer('a'), queued('c')], 'r1', new Set(), status)
      expect(r.send).toEqual([])
      expect(r.items.map((m) => [m.id, m.kind])).toEqual([['a', 'queued'], ['c', 'queued']])
    }
  })

  it('sends after a cancel only when the user chose stop and send', () => {
    const r = settleOut([queued('c'), queued('u', 'r1', true)], 'r1', new Set(), 'cancelled')
    expect(r.send.map((m) => m.id)).toEqual(['c', 'u'])
  })

  it('carries a connector focus through to the combined turn', () => {
    expect(joinOut([queued('a'), { ...queued('b'), mcpServers: ['sekudo'] }]).mcpServers).toEqual(['sekudo'])
  })
})
