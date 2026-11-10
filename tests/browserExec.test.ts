import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRunner, type ChatBackend } from '../src/main/agent/runner'
import { ProjectStore } from '../src/main/store/projectStore'
import { execTool, type ExecCtx } from '../src/main/agent/toolExec'
import { TOOL_DEFS, toolsFor } from '../src/main/agent/tools'
import { browserToolsFor, BROWSER_ACT, BROWSER_READ } from '../src/main/agent/browserDefs'
import type { BrowserBridge } from '../src/main/agent/browserTools'
import { summariseTool } from '../src/main/agent/history'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { AgentEvent, PendingApproval, RunState } from '../src/shared/types'

type Ask = Omit<PendingApproval, 'id' | 'runId' | 'project'>
const ROOT = 'C:\\proj'

/** A fake Preview page that records what the tools asked it to do. */
function bridge(url = 'http://localhost:5173/') {
  const calls: string[] = []
  const b: BrowserBridge = {
    open: async (_p, u) => (calls.push(`open ${u}`), { url: u, title: 'Shop', status: 200 }),
    page: async () => ({ url, title: 'Shop' }),
    snapshot: async (ref) => (calls.push(`snapshot ${ref ?? ''}`), 'Page: Shop\n- button "Pay" [ref=e1]'),
    click: async (ref) => (calls.push(`click ${ref}`), {}),
    type: async (ref, text, submit) => void calls.push(`type ${ref} ${text} ${submit}`),
    press: async (key) => void calls.push(`press ${key}`),
    screenshot: async () => ({ mediaType: 'image/png', data: 'iVBORw0KGgo=', width: 800, height: 600 }),
    wait: async (o) => ({ met: o.text === 'Done', ms: 300 }),
    evaluate: async (e) => (calls.push(`eval ${e}`), '"Shop"'),
    consoleEntries: () => ({ entries: [{ at: Date.now(), level: 'error', text: 'Boom' }], dropped: 0 }),
    networkEntries: () => []
  }
  return { b, calls }
}

function ctx(o: { mode?: 'build' | 'plan' | 'review'; b?: BrowserBridge; vision?: boolean; answer?: boolean } = {}) {
  const asked: Ask[] = []
  const images = new Map<string, { mediaType: string; data: string }>()
  const c = {
    run: { project: ROOT, mode: o.mode ?? 'build', model: 'm', commandsRun: [] },
    deps: {
      getSettings: async () => ({ ...DEFAULT_SETTINGS, autoApproveCommands: true }), secrets: async () => [], browser: o.b,
      modelVision: async () => !!o.vision, analyzeImage: async (name: string) => `breakdown of ${name}`
    },
    agentId: 'lead', agentName: 'Dahl', images, mcpTools: [], signal: new AbortController().signal,
    turn: { changed: new Set(), commands: [], memories: 0 },
    approve: async (x: Ask) => (asked.push(x), { approved: !!o.answer }),
    onChanged: () => {}, status: () => {}
  } as unknown as ExecCtx
  const run = (name: string, args: unknown) => execTool(c, name, JSON.stringify(args), toolsFor('lead', o.mode ?? 'build', false))
  return { c, asked, images, run }
}

describe('browser tool sets', () => {
  it('gives the lead read tools in every mode and actions only in Build', () => {
    for (const m of ['plan', 'review'] as const) {
      expect(toolsFor('lead', m, false)).toEqual(expect.arrayContaining(BROWSER_READ))
      for (const t of BROWSER_ACT) expect(toolsFor('lead', m, false)).not.toContain(t)
    }
    expect(toolsFor('lead', 'build', false)).toEqual(expect.arrayContaining([...BROWSER_READ, ...BROWSER_ACT]))
    expect(browserToolsFor('implementer', 'build')).toEqual([])
    for (const t of [...BROWSER_READ, ...BROWSER_ACT]) expect(TOOL_DEFS[t].function.name).toBe(t)
  })
  it('summarises each step for the activity list', () => {
    expect(summariseTool('browser_open', JSON.stringify({ url: '5173' }))).toBe('Preview: open 5173')
    expect(summariseTool('browser_click', JSON.stringify({ ref: 'e3', element: 'Pay button' }))).toBe('Preview: click Pay button')
    expect(summariseTool('browser_type', JSON.stringify({ ref: 'e4', text: 'x', submit: true }))).toBe('Preview: type into e4 and submit')
    expect(summariseTool('browser_wait', JSON.stringify({ text: 'Saved' }))).toBe('Preview: wait for "Saved"')
  })
})

describe('browser tools', () => {
  it('opens local pages only, without touching the pane for anything else', async () => {
    const { b, calls } = bridge()
    const t = ctx({ b, mode: 'plan' })
    const ok = await t.run('browser_open', { url: '5173' })
    expect(ok.ok).toBe(true)
    expect(ok.text).toContain('Opened http://localhost:5173/ (HTTP 200)')
    expect(ok.text).toContain('Boom')
    const bad = await t.run('browser_open', { url: 'https://example.com' })
    expect(bad.ok).toBe(false)
    expect(calls).toEqual(['open http://localhost:5173/'])
  })

  it('refuses actions outside Build mode and on pages that are not local', async () => {
    const { b, calls } = bridge()
    expect((await ctx({ b, mode: 'review' }).run('browser_click', { ref: 'e1' })).text).toMatch(/not available to this agent in review mode/)
    const remote = bridge('https://example.com/')
    const r = await ctx({ b: remote.b }).run('browser_snapshot', {})
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/not a local dev server/)
    expect(remote.calls).toEqual([])
    // the console still works there (it is the app's own log)
    expect((await ctx({ b: remote.b }).run('browser_console', {})).ok).toBe(true)
    expect(calls).toEqual([])
  })

  it('wraps snapshots as untrusted data and passes actions through', async () => {
    const { b, calls } = bridge()
    const t = ctx({ b })
    expect((await t.run('browser_snapshot', {})).text).toMatch(/^Untrusted page content follows[\s\S]*<page_snapshot>\nPage: Shop/)
    expect((await t.run('browser_click', { ref: 'e1', element: 'Pay' })).text).toMatch(/^Clicked Pay\./)
    await t.run('browser_type', { ref: 'e2', text: 'Ada', submit: 'true' })
    await t.run('browser_press', { key: 'Tab' })
    expect(calls).toEqual(['snapshot ', 'click e1', 'type e2 Ada true', 'press Tab'])
    expect((await t.run('browser_wait', { text: 'Done' })).ok).toBe(true)
    const late = await t.run('browser_wait', { text: 'Never', timeout_seconds: 1 })
    expect(late.ok).toBe(false)
    expect(late.text).toMatch(/Timed out after 1 s/)
  })

  it('always asks before running JavaScript, even with auto-approve on', async () => {
    const declined = bridge()
    const no = ctx({ b: declined.b, answer: false })
    const r = await no.run('browser_eval', { expression: 'document.title' })
    expect(r.ok).toBe(false)
    expect(no.asked).toHaveLength(1)
    expect(no.asked[0]).toMatchObject({ kind: 'browser', tool: 'Run JavaScript in the Preview page' })
    expect(no.asked[0].args).toContain('document.title')
    expect(declined.calls).toEqual([])
    const yes = bridge()
    const r2 = await ctx({ b: yes.b, answer: true }).run('browser_eval', { expression: 'document.title' })
    expect(r2.text).toContain('"Shop"')
    expect(yes.calls).toEqual(['eval document.title'])
  })

  it('sends screenshots to vision models and a text breakdown to the others', async () => {
    const { b } = bridge()
    const v = ctx({ b, vision: true })
    const seen = await v.run('browser_screenshot', {})
    expect(seen.images?.[0]).toMatchObject({ mediaType: 'image/png' })
    expect(v.images.size).toBe(1)
    const blind = await ctx({ b }).run('browser_screenshot', {})
    expect(blind.images).toBeUndefined()
    expect(blind.text).toMatch(/text breakdown:\nbreakdown of preview-\d+\.png/)
  })

  it('says so when there is no Preview pane', async () => {
    expect((await ctx().run('browser_snapshot', {})).text).toMatch(/not available/)
  })
})

describe('browser tools in a task', () => {
  it('sends the read-only tools in Plan mode and lists each step in the activity list', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-bt-'))
    try {
      const { b, calls } = bridge()
      const queue = [{ name: 'browser_open', args: { url: '5173' } }, { name: 'browser_click', args: { ref: 'e1', element: 'Pay button' } }]
      const sent: string[][] = []
      const backend: ChatBackend = {
        async chat(req) {
          sent.push(((req.tools ?? []) as { function: { name: string } }[]).map((t) => t.function.name))
          const t = queue.shift()
          return { content: t ? '' : 'Checked the page.', reasoning: '', toolCalls: t ? [{ id: `c${sent.length}`, type: 'function' as const, function: { name: t.name, arguments: JSON.stringify(t.args) } }] : [] }
        }
      }
      const events: AgentEvent[] = []
      const runner = new AgentRunner({
        backend, getSettings: async () => ({ ...DEFAULT_SETTINGS, autoMemory: false, maintainProgress: false }), emit: (e) => void events.push(e),
        runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [], browser: b
      })
      await runner.start({ project: dir, prompt: 'check the page', mode: 'plan', model: 'm' })
      while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
      expect(sent[0]).toEqual(expect.arrayContaining(BROWSER_READ))
      expect(sent[0]).not.toContain('browser_click')
      const run = (await new ProjectStore(dir).loadRun(events[0].runId)) as RunState
      const steps = run.transcript.filter((t) => t.kind === 'tool').map((t) => [t.text, t.tool?.ok])
      expect(steps).toEqual([['Preview: open 5173', true], ['Preview: click Pay button', false]])
      expect(calls).toEqual(['open http://localhost:5173/'])
    } finally {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 })
    }
  })
})
