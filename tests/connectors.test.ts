import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { McpManager } from '../src/main/mcp/manager'
import { AgentRunner, type ChatBackend, type McpBridge } from '../src/main/agent/runner'
import { ProjectStore } from '../src/main/store/projectStore'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { AgentEvent, McpToolRef, RunState } from '../src/shared/types'

// Seen live: every turn waited up to 45 s for seven connectors that "did not start within 45 s", and Supabase without
// its token failed on every turn. Connector tool schemas also inflated every prompt.

let dir: string
beforeEach(async () => (dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-conn-'))))
afterEach(async () => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }))

function manager(): McpManager {
  const secrets = new Map<string, string>()
  return new McpManager({ appDir: dir, bundledEntry: () => null, getSecret: async (k) => secrets.get(k) ?? null, setSecret: async (k, v) => void (v ? secrets.set(k, v) : secrets.delete(k)), onChange: () => {} })
}

describe('connector manager', () => {
  it('skips a catalogue connector whose required secret is missing, without an error', async () => {
    const m = manager()
    const sb = await m.installFromCatalog('supabase')
    await m.update(sb.id, { enabled: true }) // installed connectors start switched off
    const problems: string[] = []
    const t0 = Date.now()
    expect(await m.toolsFor(dir, undefined, problems, 2500)).toEqual([])
    expect(problems).toEqual([])
    expect(Date.now() - t0).toBeLessThan(2000)
    expect((await m.connectors(dir))[0]).toMatchObject({ state: 'needs_setup' })
  })

  it('gives a server that never answers only the short wait budget', async () => {
    const m = manager()
    const stuck = await m.addCustom({ name: 'Stuck', transport: 'stdio', command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], policy: 'ask' })
    await m.update(stuck.id, { enabled: true })
    const problems: string[] = []
    const t0 = Date.now()
    expect(await m.toolsFor(dir, undefined, problems, 800)).toEqual([])
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(problems).toEqual([])
    expect((await m.connectors(dir))[0]).toMatchObject({ name: 'Stuck', state: 'starting' })
    m.stopAll()
  })
})

const tool = (server: string, i: number): McpToolRef => ({ serverId: server, serverName: server === 'big' ? 'Big' : 'Small', policy: 'allow', tool: { name: `t${i}`, description: `tool ${i}`, readOnly: true }, fnName: `mcp__${server}__t${i}` })

describe('connector tools load on demand', () => {
  it('lists a large connector by name and loads its tools only after use_connector', async () => {
    const big = Array.from({ length: 20 }, (_, i) => tool('big', i))
    const bridge: McpBridge = {
      toolsFor: async () => big,
      connectors: async () => [{ id: 'big', name: 'Big', description: 'Lots of tools', state: 'ready', tools: 20 }],
      ensure: async () => big,
      call: async (_s, _p, t) => ({ text: `ran ${t}`, isError: false, images: [] })
    }
    const seenTools: string[][] = []
    let systemText = ''
    let n = 0
    const backend: ChatBackend = {
      async chat(req) {
        n++
        seenTools.push(((req.tools ?? []) as { function: { name: string } }[]).map((t) => t.function.name))
        if (n === 1) systemText = String(req.messages[0].content)
        if (n === 1) return { content: '', reasoning: '', toolCalls: [{ id: 'u', type: 'function', function: { name: 'use_connector', arguments: '{"name":"Big"}' } }] }
        if (n === 2) return { content: '', reasoning: '', toolCalls: [{ id: 'c', type: 'function', function: { name: 'mcp__big__t3', arguments: '{}' } }] }
        return { content: 'Done.', reasoning: '', toolCalls: [] }
      }
    }
    const events: AgentEvent[] = []
    const runner = new AgentRunner({ backend, getSettings: async () => DEFAULT_SETTINGS, emit: (e) => events.push(e), runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [], mcp: bridge })
    await runner.start({ project: dir, prompt: 'use big', mode: 'build', model: 'm' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    expect(seenTools[0]).toContain('use_connector')
    expect(seenTools[0].some((t) => t.startsWith('mcp__big__'))).toBe(false)
    expect(systemText).toMatch(/Big \[ready, 20 tools\]: Lots of tools/)
    expect(seenTools[1].filter((t) => t.startsWith('mcp__big__'))).toHaveLength(20)
    const run = (await new ProjectStore(dir).loadRun(events[0].runId)) as RunState
    expect(run.status).toBe('completed')
    expect(run.transcript.filter((t) => t.kind === 'tool').map((t) => t.tool?.ok)).toEqual([true, true])
  })

  it('keeps a small set of connector tools loaded from the start', async () => {
    const small = Array.from({ length: 4 }, (_, i) => tool('small', i))
    const bridge: McpBridge = { toolsFor: async () => small, call: async () => ({ text: 'ok', isError: false, images: [] }) }
    let first: string[] = []
    const backend: ChatBackend = { async chat(req) { if (!first.length) first = ((req.tools ?? []) as { function: { name: string } }[]).map((t) => t.function.name); return { content: 'ok', reasoning: '', toolCalls: [] } } }
    const runner = new AgentRunner({ backend, getSettings: async () => DEFAULT_SETTINGS, emit: () => {}, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [], mcp: bridge })
    await runner.start({ project: dir, prompt: 'hi', mode: 'build', model: 'm' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    expect(first.filter((t) => t.startsWith('mcp__small__'))).toHaveLength(4)
    expect(first).not.toContain('use_connector')
  })
})
