import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import type { AgentEvent } from '@shared/types'
import { LiveMarkdown, Markdown, splitBlocks } from '../src/renderer/src/components/Markdown'

const REPLY = [
  '## Plan',
  '',
  'First paragraph with `code` and **bold**.',
  '',
  '1. Step one',
  '',
  '   Details for step one, indented under the item.',
  '2. Step two',
  '',
  '```ts',
  'const a = 1',
  '',
  'const b = 2',
  '```',
  '',
  '| File | Change |',
  '|---|---|',
  '| a.ts | edited |',
  '',
  'Done.'
].join('\n')

describe('streaming Markdown blocks', () => {
  it('splits at blank lines but keeps code fences and indented continuations whole', () => {
    const blocks = splitBlocks(REPLY)
    expect(blocks.join('\n')).toBe(REPLY)
    expect(blocks.map((b: string) => b.trim().split('\n')[0])).toEqual(['## Plan', 'First paragraph with `code` and **bold**.', '1. Step one', '```ts', '| File | Change |', 'Done.'])
    expect(blocks[2]).toContain('Details for step one')
    expect(blocks[3]).toContain('const b = 2')
  })

  it('earlier blocks never change while the reply grows, so their render is reused', () => {
    let prev: string[] = []
    for (let n = 1; n <= REPLY.length; n++) {
      const cur = splitBlocks(REPLY.slice(0, n))
      for (let i = 0; i < prev.length - 1; i++) expect(cur[i]).toBe(prev[i])
      prev = cur
    }
  })

  it('renders the same HTML as rendering the whole reply at once', () => {
    const live = renderToString(createElement(LiveMarkdown, { text: REPLY }))
    const full = renderToString(createElement(Markdown, { text: REPLY }))
    const norm = (s: string) => s.replace(/>\s+</g, '><')
    // list numbering survives the split (the second chunk renders as <ol start="2"> or continues the same list)
    expect(norm(live)).toContain('Step two')
    expect(norm(live).replace(/<\/ol><ol start="2">/g, '')).toBe(norm(full).replace(/<\/ol><ol start="2">/g, ''))
  })
})

describe('streamed token batching', () => {
  let store: typeof import('../src/renderer/src/store')
  beforeAll(async () => {
    ;(globalThis as unknown as { window: unknown }).window = { dahl: {} }
    store = await import('../src/renderer/src/store')
  })

  it('applies buffered tokens in one update and before the event that ends the live text', () => {
    vi.useFakeTimers()
    const root = 'C:/p'
    const ev = (e: Partial<AgentEvent>) => store.handleAgentEvent({ runId: 'r1', project: root, ...e } as AgentEvent)
    let updates = 0
    const off = store.useStore.subscribe(() => updates++)
    for (const t of ['Hel', 'lo ', 'wor', 'ld']) ev({ type: 'delta', delta: t })
    ev({ type: 'reasoning_delta', delta: 'thinking' })
    expect(store.useStore.getState().project(root).live).toBe('')
    vi.advanceTimersByTime(100)
    expect(store.useStore.getState().project(root).live).toBe('Hello world')
    expect(store.useStore.getState().project(root).liveReasoning).toBe('thinking')
    expect(updates).toBe(1)

    ev({ type: 'delta', delta: '!' })
    ev({ type: 'transcript', item: { id: 'i1', at: '', kind: 'assistant', text: 'Hello world!' } })
    const p = store.useStore.getState().project(root)
    expect(p.live).toBe('')
    expect(p.transcript.at(-1)?.text).toBe('Hello world!')
    vi.advanceTimersByTime(100)
    expect(store.useStore.getState().project(root).live).toBe('')
    off()
    vi.useRealTimers()
  })
})
