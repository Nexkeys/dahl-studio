import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { autoApproved } from '../src/main/agent/approvals'
import { execTool, type ExecCtx } from '../src/main/agent/toolExec'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { McpToolRef, PendingApproval, Settings } from '../src/shared/types'

type Ask = Omit<PendingApproval, 'id' | 'runId' | 'project'>
let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-appr-'))
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\n')
})
afterEach(async () => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }))

const mcpTool: McpToolRef = { serverId: 'srv', serverName: 'Srv', policy: 'ask', tool: { name: 'write_thing', readOnly: false }, fnName: 'mcp__srv__write_thing' }

function ctx(settings: Partial<Settings>, mode = 'build') {
  const asked: Ask[] = []
  const c = {
    run: { project: dir, mode, commandsRun: [], changedFiles: [], backups: {} },
    deps: {
      getSettings: async () => ({ ...DEFAULT_SETTINGS, ...settings }), secrets: async () => [],
      runCommand: async () => ({ exitCode: 0, output: 'ok', timedOut: false }),
      mcp: { toolsFor: async () => [], call: async () => ({ text: 'done', isError: false, images: [] }), checkArgs: async () => {} }
    },
    agentId: 'lead', agentName: 'Dahl', leases: new Map(), mcpTools: [mcpTool],
    turn: { changed: new Set(), commands: [], memories: 0 },
    approve: async (x: Ask) => (asked.push(x), { approved: true }),
    onChanged: () => {}, status: () => {}
  } as unknown as ExecCtx
  return { asked, run: (name: string, args: unknown) => execTool(c, name, JSON.stringify(args), [name]) }
}

describe('never ask', () => {
  it('decides per kind, keeping publishing behind its own switch', () => {
    const s = (o: Partial<Settings>) => ({ ...DEFAULT_SETTINGS, ...o })
    expect(autoApproved(s({}), 'write')).toBe(false)
    expect(autoApproved(s({ autoApproveAll: true }), 'write')).toBe(true)
    expect(autoApproved(s({ autoApproveAll: true }), 'command')).toBe(true)
    expect(autoApproved(s({ autoApproveAll: true }), 'mcp')).toBe(true)
    expect(autoApproved(s({ autoApproveAll: true }), 'publish')).toBe(false) // askBeforePublishing defaults to true
    expect(autoApproved(s({ autoApproveAll: true, askBeforePublishing: false }), 'publish')).toBe(true)
    expect(autoApproved(s({ autoApproveWrites: true }), 'publish')).toBe(false)
  })

  it('runs writes, commands and connector tools without an approval card', async () => {
    const t = ctx({ autoApproveAll: true })
    expect((await t.run('write_file', { path: 'a.txt', content: 'two\n' })).ok).toBe(true)
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('two\n')
    expect((await t.run('run_command', { command: 'echo hi' })).ok).toBe(true)
    expect((await t.run('mcp__srv__write_thing', {})).ok).toBe(true)
    expect(t.asked).toEqual([])
  })

  it('still asks for everything when it is off', async () => {
    const t = ctx({})
    await t.run('write_file', { path: 'a.txt', content: 'two\n' })
    await t.run('run_command', { command: 'echo hi' })
    await t.run('mcp__srv__write_thing', {})
    expect(t.asked.map((a) => a.kind)).toEqual(['write', 'command', 'mcp'])
  })

  it('does not ask for connector tools in Review mode either', async () => {
    const t = ctx({ autoApproveAll: true }, 'review')
    expect((await t.run('mcp__srv__write_thing', {})).ok).toBe(true)
    expect(t.asked).toEqual([])
  })
})
