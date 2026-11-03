import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { streamChat, DahlError } from '../src/main/dahl/client'
import { AgentRunner, type ChatBackend } from '../src/main/agent/runner'
import { ProjectStore } from '../src/main/store/projectStore'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { AgentEvent, RunState } from '../src/shared/types'

// Seen live on 2026-11-03: under load the Dahl API cut streams. One failed the turn ("Network error: terminated"), and
// one simply stopped, so a security report ending "Ran the full 34" was saved as the finished answer.

const sse = (chunks: unknown[]): typeof fetch =>
  (async () => new Response(chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch
const call = (f: typeof fetch) => streamChat('k', { model: 'm', messages: [] }, new AbortController().signal, {}, f)

describe('stream end detection', () => {
  it('rejects a stream that stops without [DONE] or a finish_reason', async () => {
    const p = call(sse([{ choices: [{ delta: { content: '# Report\n\n- Ran the full 34' } }] }]))
    await expect(p).rejects.toBeInstanceOf(DahlError)
    await expect(p).rejects.toMatchObject({ kind: 'network' })
  })

  it('accepts a stream that ends with a finish_reason even without [DONE]', async () => {
    const r = await call(sse([{ choices: [{ delta: { content: 'All good' }, finish_reason: 'stop' }] }]))
    expect(r.content).toBe('All good')
  })

  it('accepts [DONE] without a finish_reason', async () => {
    const r = await call(sse([{ choices: [{ delta: { content: 'ok' } }] }, '[DONE]']))
    expect(r.content).toBe('ok')
  })
})

describe('lead agent recovers from a dropped stream', () => {
  let dir: string
  beforeEach(async () => (dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-stream-'))))
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }))

  it('retries the step, clears the partial text on screen and keeps only the full answer', async () => {
    let calls = 0
    const backend: ChatBackend = {
      async chat(_req, _signal, cb) {
        calls++
        if (calls === 1) {
          cb?.onDelta?.('# Report\n\nRan the full 34')
          throw new DahlError('network', 'Network error: terminated')
        }
        cb?.onDelta?.('# Report\n\nRan the full 34 checks. Nothing critical.')
        return { content: '# Report\n\nRan the full 34 checks. Nothing critical.', reasoning: '', toolCalls: [], finishReason: 'stop' }
      }
    }
    const events: AgentEvent[] = []
    const runner = new AgentRunner({ backend, getSettings: async () => DEFAULT_SETTINGS, emit: (e) => events.push(e), runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [] })
    await runner.start({ project: dir, prompt: 'scan it', mode: 'review', model: 'm' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    expect(calls).toBe(2)
    const run = (await new ProjectStore(dir).loadRun(events[0].runId)) as RunState
    expect(run.status).toBe('completed')
    const said = run.transcript.filter((t) => t.kind === 'assistant').map((t) => t.text)
    expect(said).toEqual(['# Report\n\nRan the full 34 checks. Nothing critical.'])
    const retry = run.transcript.find((t) => t.kind === 'status' && t.resetLive)
    expect(retry?.text).toMatch(/Retrying \(1 of 2\)/)
    // the partial reply never became part of the conversation sent to the model
    expect(run.messages.filter((m) => m.role === 'assistant')).toHaveLength(1)
  })
})
