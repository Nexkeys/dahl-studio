import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseToolArgs } from '../src/main/agent/args'
import { TOOL_DEFS } from '../src/main/agent/tools'
import { AgentRunner, type ChatBackend } from '../src/main/agent/runner'
import { ProjectStore } from '../src/main/store/projectStore'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { AgentEvent, RunState } from '../src/shared/types'

// Seen live (Kestrel run, MiniMax M2.7): {"agents": "[{\"role\": ...}]"}, the array sent as a JSON string, crashed the
// whole task with "specs.entries is not a function". Weaker models do this with arrays, objects, numbers and booleans.

const schema = (n: keyof typeof TOOL_DEFS) => TOOL_DEFS[n].function.parameters

describe('tool argument repair', () => {
  it('parses arrays and objects that arrive as JSON strings', () => {
    const r = parseToolArgs(JSON.stringify({ agents: JSON.stringify([{ role: 'implementer', task: 'x' }]) }), schema('delegate_agents'))
    expect(r.ok && r.args.agents).toEqual([{ role: 'implementer', task: 'x' }])
  })

  it('coerces numbers and booleans, and wraps a single object where an array is expected', () => {
    const r = parseToolArgs(JSON.stringify({ path: 'a.ts', start_line: '3', end_line: '9' }), schema('read_file'))
    expect(r.ok && r.args).toEqual({ path: 'a.ts', start_line: 3, end_line: 9 })
    const s = parseToolArgs(JSON.stringify({ query: 'x', regex: 'true' }), schema('search'))
    expect(s.ok && s.args.regex).toBe(true)
    const w = parseToolArgs(JSON.stringify({ agents: { role: 'researcher', task: 'look' } }), schema('delegate_agents'))
    expect(w.ok && w.args.agents).toEqual([{ role: 'researcher', task: 'look' }])
  })

  it('repairs nested stringified items and code-fenced or trailing-comma JSON', () => {
    const r = parseToolArgs(JSON.stringify({ steps: [JSON.stringify({ title: 'A', status: 'done' })] }), schema('update_plan'))
    expect(r.ok && r.args.steps).toEqual([{ title: 'A', status: 'done' }])
    const f = parseToolArgs('```json\n{"path": "a.ts",}\n```', schema('read_file'))
    expect(f.ok && f.args.path).toBe('a.ts')
  })

  it('leaves real strings alone and still rejects text that is not JSON', () => {
    const r = parseToolArgs(JSON.stringify({ path: 'notes.md', content: '[not, json' }), schema('write_file'))
    expect(r.ok && r.args.content).toBe('[not, json')
    expect(parseToolArgs('{"path": "a.ts", "content": "cut off', schema('write_file')).ok).toBe(false)
  })
})

describe('a malformed tool call never kills the task', () => {
  let dir: string
  beforeEach(async () => (dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-args-'))))
  afterEach(async () => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }))

  it('runs delegate_agents with a stringified agents list', async () => {
    let n = 0
    const backend: ChatBackend = {
      async chat(req) {
        n++
        const sys = typeof req.messages[0].content === 'string' ? req.messages[0].content : ''
        if (sys.includes('sub-agent')) return { content: 'Found it in a.txt', reasoning: '', toolCalls: [] }
        if (n === 1) return { content: '', reasoning: '', toolCalls: [{ id: 'd1', type: 'function', function: { name: 'delegate_agents', arguments: JSON.stringify({ agents: JSON.stringify([{ role: 'researcher', task: 'Find the greeting' }]) }) } }] }
        return { content: 'The researcher found it.', reasoning: '', toolCalls: [] }
      }
    }
    const events: AgentEvent[] = []
    const runner = new AgentRunner({ backend, getSettings: async () => DEFAULT_SETTINGS, emit: (e) => events.push(e), runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [] })
    await runner.start({ project: dir, prompt: 'find it', mode: 'review', model: 'm' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    const run = (await new ProjectStore(dir).loadRun(events[0].runId)) as RunState
    expect(run.status).toBe('completed')
    expect(run.transcript.find((t) => t.kind === 'tool' && t.tool?.name === 'delegate_agents')?.tool?.ok).toBe(true)
  })

  it('turns an exception inside a tool into an error the model can read', async () => {
    let n = 0
    const backend: ChatBackend = {
      async chat() {
        n++
        if (n === 1) return { content: '', reasoning: '', toolCalls: [{ id: 'x1', type: 'function', function: { name: 'delegate_agents', arguments: JSON.stringify({ agents: 'not a list at all' }) } }] }
        return { content: 'Recovered.', reasoning: '', toolCalls: [] }
      }
    }
    const events: AgentEvent[] = []
    const runner = new AgentRunner({ backend, getSettings: async () => DEFAULT_SETTINGS, emit: (e) => events.push(e), runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [] })
    await runner.start({ project: dir, prompt: 'go', mode: 'review', model: 'm' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    const run = (await new ProjectStore(dir).loadRun(events[0].runId)) as RunState
    expect(run.status).toBe('completed')
    expect(run.transcript.find((t) => t.kind === 'tool')?.tool?.result).toMatch(/agents must be a list/i)
  })
})
