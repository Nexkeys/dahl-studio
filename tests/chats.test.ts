import { describe, expect, it, vi, beforeAll } from 'vitest'
import type { AgentEvent } from '../src/shared/types'
import { blankSnap, overallStatus, patchChat, routeTarget, type ChatFields } from '../src/renderer/src/chatState'

const fields = (over: Partial<ChatFields> = {}): ChatFields => ({
  ...blankSnap(),
  chats: [{ key: 'a', title: 'A', runId: null, status: null, snap: null }, { key: 'b', title: 'B', runId: 'r2', status: 'running', snap: { ...blankSnap(), runId: 'r2', status: 'running' } }],
  chat: 'a',
  startingChat: null,
  ...over
})

describe('chat tab routing', () => {
  it('sends events for a background run to that chat, not the one on screen', () => {
    const c = fields()
    expect(routeTarget(c, 'r2')).toBe('b')
    const patch = patchChat(c, 'r2', (s) => ({ live: s.live + 'hi' }))
    expect(patch.live).toBeUndefined()
    expect(patch.chats!.find((t) => t.key === 'b')!.snap!.live).toBe('hi')
  })

  it('gives a new run to the chat that started it, even after switching away', () => {
    const c = fields({ chat: 'b', runId: 'r2', status: 'running', startingChat: 'a', chats: [{ key: 'a', title: 'A', runId: null, status: null, snap: blankSnap() }, { key: 'b', title: 'B', runId: 'r2', status: 'running', snap: null }] })
    const patch = patchChat(c, 'r9', () => ({ runId: 'r9', status: 'running' }))
    const a = patch.chats!.find((t) => t.key === 'a')!
    expect(a.runId).toBe('r9')
    expect(a.snap!.status).toBe('running')
    expect(patch.startingChat).toBeNull()
  })

  it('updates the view and its tab for the active run', () => {
    const c = fields({ runId: 'r1' })
    const patch = patchChat(c, 'r1', () => ({ status: 'completed' }))
    expect(patch.status).toBe('completed')
    expect(patch.chats!.find((t) => t.key === 'a')!.status).toBe('completed')
  })

  it('reports a working background chat as the project status', () => {
    expect(overallStatus(fields({ status: 'completed' }))).toBe('running')
    expect(overallStatus(fields({ chats: [], status: 'paused' }))).toBe('paused')
  })
})

describe('store with chat tabs', () => {
  let store: typeof import('../src/renderer/src/store')
  beforeAll(async () => {
    ;(globalThis as unknown as { window: unknown }).window = { dahl: {} }
    store = await import('../src/renderer/src/store')
  })

  it('streams a background chat without touching the visible one', () => {
    vi.useFakeTimers()
    const root = 'C:/chats'
    const st = store.useStore.getState()
    st.patchProject(root, fields({ runId: 'r1', transcript: [{ id: 'x', at: '', kind: 'user', text: 'visible' }] }))
    const ev = (e: Partial<AgentEvent>) => store.handleAgentEvent({ project: root, ...e } as AgentEvent)
    ev({ runId: 'r2', type: 'delta', delta: 'bg ' })
    ev({ runId: 'r1', type: 'delta', delta: 'fg' })
    vi.advanceTimersByTime(100)
    ev({ runId: 'r2', type: 'transcript', item: { id: 'y', at: '', kind: 'assistant', text: 'bg done' } })
    const p = store.useStore.getState().project(root)
    expect(p.live).toBe('fg')
    expect(p.transcript.map((t) => t.text)).toEqual(['visible'])
    const b = p.chats.find((t) => t.key === 'b')!.snap!
    expect(b.live).toBe('')
    expect(b.transcript.at(-1)?.text).toBe('bg done')
    vi.useRealTimers()
  })
})
