import { describe, it, expect } from 'vitest'
import type { PendingApproval, TranscriptItem } from '@shared/types'
import { blankSnap, newTab, type ChatFields } from '../src/renderer/src/chatState'
import { chatKind, countNeeds, currentAction, describeTool, formatElapsed, markUnread, projectKind, statusKind, topKind, turnStart, waitsForAnswer } from '../src/renderer/src/status'

const item = (kind: TranscriptItem['kind'], text: string, extra: Partial<TranscriptItem> = {}): TranscriptItem => ({ id: Math.random().toString(36), kind, text, at: '2026-11-08T10:00:00.000Z', ...extra })
const tool = (name: string, args: object, agent?: string): TranscriptItem => item('tool', name, { tool: { name, args: JSON.stringify(args), ok: true, agent } })

function project(view: Partial<ChatFields>, others: Partial<ReturnType<typeof newTab>>[] = []): ChatFields {
  const a = newTab()
  return { ...blankSnap(), ...view, chats: [a, ...others.map((o) => ({ ...newTab(), ...o }))], chat: a.key, startingChat: null }
}

describe('status vocabulary', () => {
  it('maps run states to distinct kinds; waiting for approval is never "working"', () => {
    expect(statusKind('waiting_approval')).toBe('needs')
    expect(statusKind('running')).toBe('running')
    expect(statusKind('failed')).toBe('failed')
    expect(statusKind('interrupted')).toBe('paused')
    expect(statusKind('paused')).toBe('paused')
    expect(statusKind('completed')).toBe('done')
    expect(statusKind('completed', true)).toBe('unread')
    expect(statusKind('cancelled')).toBe('idle')
    expect(statusKind(null)).toBe('idle')
  })

  it('combines chats by priority: needs you, working, failed, unread, paused, done, idle', () => {
    expect(topKind(['done', 'running', 'needs'])).toBe('needs')
    expect(topKind(['paused', 'failed', 'running'])).toBe('running')
    expect(topKind(['paused', 'unread'])).toBe('unread')
    expect(topKind([])).toBe('idle')
    const p = project({ status: 'running' }, [{ status: 'waiting_approval', runId: 'b' }, { status: 'failed', runId: 'c' }])
    expect(projectKind(p)).toBe('needs')
    expect(chatKind(p, p.chat)).toBe('running')
    expect(countNeeds({ a: p, b: project({ status: 'waiting_approval' }) })).toBe(2)
  })

  it('marks a chat that finished off screen as unread, and leaves the one on screen alone', () => {
    const p = project({ runId: 'r1', status: 'completed' }, [{ runId: 'r2', status: 'completed' }])
    expect(markUnread(p, 'r1', true)).toBeNull()
    expect(markUnread(p, 'r1', false)!.chats!.find((t) => t.key === p.chat)!.unread).toBe(true)
    const bg = markUnread(p, 'r2', true)!.chats!.find((t) => t.runId === 'r2')!
    expect(bg.unread).toBe(true)
    expect(projectKind({ ...p, chats: markUnread(p, 'r2', true)!.chats! })).toBe('unread')
  })

  it('tells a question from an approval', () => {
    const q: PendingApproval = { id: 'q', runId: 'r', project: 'p', kind: 'question' }
    const w: PendingApproval = { id: 'w', runId: 'r', project: 'p', kind: 'write', path: 'a.ts' }
    expect(waitsForAnswer([q], 'r', [])).toBe(true)
    expect(waitsForAnswer([w], 'r', [])).toBe(false)
    expect(waitsForAnswer([], 'r', [item('approval', 'Question: Which database?')])).toBe(true)
  })
})

describe('current action line', () => {
  const base = { status: 'running' as const, live: '', liveReasoning: '', approvals: [] as PendingApproval[], runId: 'r' }

  it('says what Dahl waits for, in words', () => {
    const cmd: PendingApproval = { id: 'c', runId: 'r', project: 'p', kind: 'command', command: 'npm test' }
    expect(currentAction({ ...base, status: 'waiting_approval', transcript: [], approvals: [cmd] }).text).toBe('Waiting for you to approve: npm test')
    const w: PendingApproval = { id: 'w', runId: 'r', project: 'p', kind: 'write', path: 'src/app.ts' }
    expect(currentAction({ ...base, status: 'waiting_approval', transcript: [], approvals: [w] }).text).toBe('Waiting for you to approve a change to src/app.ts')
    expect(currentAction({ ...base, status: 'waiting_approval', transcript: [item('approval', 'Question: Which?')] }).text).toBe('Waiting for your answer')
  })

  it('names the running command, the reply, and the last finished step', () => {
    const t = [item('user', 'go'), tool('edit_file', { path: 'src/cart.ts' }), item('approval', 'Approve command: npm test')]
    expect(currentAction({ ...base, transcript: t })).toEqual({ text: 'Running npm test', last: 'Edited src/cart.ts' })
    expect(currentAction({ ...base, live: 'Hello', transcript: t }).text).toBe('Writing the reply')
    expect(currentAction({ ...base, liveReasoning: 'hmm', transcript: t }).text).toBe('Thinking')
    expect(currentAction({ ...base, transcript: [item('user', 'go'), tool('read_file', { path: 'a.ts' })] })).toEqual({ text: 'Deciding the next step', last: 'Read a.ts' })
    // only the current turn counts
    expect(currentAction({ ...base, transcript: [tool('read_file', { path: 'old.ts' }), item('user', 'again')] })).toEqual({ text: 'Thinking', last: null })
  })

  it('describes tools for people', () => {
    expect(describeTool({ name: 'run_command', args: '{"command":"npm test"}' }, true)).toBe('Running npm test')
    expect(describeTool({ name: 'write_file', args: '{"path":"a.ts"}', agent: 'Implementer' })).toBe('Implementer: Wrote a.ts')
    expect(describeTool({ name: 'mcp__github__list_issues', args: '{"path":' })).toBe('Used github / list issues')
  })

  it('formats elapsed time and finds the start of a restored turn', () => {
    expect(formatElapsed(9_400)).toBe('9s')
    expect(formatElapsed(72_000)).toBe('1m 12s')
    expect(formatElapsed(3_725_000)).toBe('1h 02m')
    expect(turnStart(123, [])).toBe(123)
    expect(turnStart(null, [item('user', 'x')])).toBe(Date.parse('2026-11-08T10:00:00.000Z'))
  })
})
