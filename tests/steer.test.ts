import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRunner, type ChatBackend } from '../src/main/agent/runner'
import { ProjectStore } from '../src/main/store/projectStore'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { AgentEvent, ChatMessage, RunState } from '../src/shared/types'

let dir: string
beforeEach(async () => (dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-steer-'))))
afterEach(async () => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }))

const text = (m: ChatMessage): string => (typeof m.content === 'string' ? m.content : '')

describe('messages sent while Dahl works', () => {
  it('reaches the model at the next step of the same task', async () => {
    let release!: () => void
    const commandRunning = new Promise<void>((r) => (release = r))
    const seen: ChatMessage[][] = []
    const backend: ChatBackend = {
      async chat(req) {
        seen.push(req.messages)
        if (seen.length === 1) return { content: '', reasoning: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'run_command', arguments: '{"command":"npm test"}' } }] }
        return { content: 'Done, and I used port 4000 as you asked.', reasoning: '', toolCalls: [] }
      }
    }
    const events: AgentEvent[] = []
    let started!: () => void
    const commandStarted = new Promise<void>((r) => (started = r))
    const runner = new AgentRunner({
      backend, getSettings: async () => ({ ...DEFAULT_SETTINGS, autoApproveAll: true }), emit: (e) => events.push(e),
      runCommand: async () => (started(), await commandRunning, { exitCode: 0, output: 'ok', timedOut: false }), secrets: async () => []
    })
    await runner.start({ project: dir, prompt: 'run the tests', mode: 'build', model: 'm' })
    await commandStarted
    expect(runner.steer(dir, 's1', 'Use port 4000 instead')).toBe(true)
    release()
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    const second = seen[1]
    expect(text(second.at(-1)!)).toMatch(/^Use port 4000 instead/)
    expect(second.at(-2)?.role).toBe('tool') // after the tool result, as a real user message
    const run = (await new ProjectStore(dir).loadRun(events[0].runId)) as RunState
    expect(run.status).toBe('completed')
    expect(run.transcript.find((t) => t.steerId === 's1')?.kind).toBe('user')
  })

  it('takes one more step when a message arrives while the final answer is being written', async () => {
    let calls = 0
    let runnerRef!: AgentRunner
    const backend: ChatBackend = {
      async chat(req) {
        calls++
        if (calls === 1) {
          runnerRef.steer(dir, 's2', 'Also add a README line')
          return { content: 'All done.', reasoning: '', toolCalls: [] }
        }
        expect(text(req.messages.at(-1)!)).toMatch(/^Also add a README line/)
        return { content: 'Added the README line too.', reasoning: '', toolCalls: [] }
      }
    }
    runnerRef = new AgentRunner({ backend, getSettings: async () => DEFAULT_SETTINGS, emit: () => {}, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [] })
    await runnerRef.start({ project: dir, prompt: 'finish up', mode: 'review', model: 'm' })
    while (runnerRef.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    expect(calls).toBe(2)
  })

  it('refuses when nothing is running, so the app starts a normal turn instead', () => {
    const runner = new AgentRunner({ backend: { chat: async () => ({ content: '', reasoning: '', toolCalls: [] }) }, getSettings: async () => DEFAULT_SETTINGS, emit: () => {}, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [] })
    expect(runner.steer(dir, 's3', 'hello')).toBe(false)
  })
})
