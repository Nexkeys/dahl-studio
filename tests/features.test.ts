import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRunner, cleanModelText, type ChatBackend } from '../src/main/agent/runner'
import { repairHistory, buildUserContent, compact } from '../src/main/agent/history'
import { unwrapPowershell } from '../src/main/agent/toolExec'
import { toAnthropic } from '../src/main/providers/anthropic'
import { toOpenAIMessages, extractRemaining, streamChat } from '../src/main/dahl/client'
import { parseDuckDuckGoHtml, htmlToText } from '../src/main/tools/web'
import { ReasoningStore } from '../src/main/store/reasoning'
import { ProjectStore } from '../src/main/store/projectStore'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { AgentEvent, ChatMessage, PendingApproval } from '../src/shared/types'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-feat-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('history repair (fixes "400 Unterminated string" loops)', () => {
  it('replaces truncated tool-call arguments with valid JSON and answers dangling calls', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'x' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'write_file', arguments: '{"path":"index.html","content":"<html' } }] }
    ]
    repairHistory(msgs)
    expect(() => JSON.parse(msgs[1].tool_calls![0].function.arguments)).not.toThrow()
    expect(msgs[2]).toMatchObject({ role: 'tool', tool_call_id: 't1' })
  })

  it('runner recovers after a truncated write_file call instead of failing every later request', async () => {
    const seen: ChatMessage[][] = []
    const responses = [
      { toolCalls: [{ id: 'c1', type: 'function' as const, function: { name: 'write_file', arguments: '{"path":"big.html","content":"<html><bo' } }] },
      { toolCalls: [] as never[], content: 'Understood: the content was too large for one call.' }
    ]
    const backend: ChatBackend = {
      async chat(req) {
        seen.push(JSON.parse(JSON.stringify(req.messages)))
        // a real API rejects history with invalid JSON arguments
        for (const m of req.messages) for (const tc of m.tool_calls ?? []) JSON.parse(tc.function.arguments)
        const r = responses.shift()!
        return { content: r.content ?? '', reasoning: '', toolCalls: r.toolCalls }
      }
    }
    const runner = new AgentRunner({ backend, getSettings: async () => DEFAULT_SETTINGS, emit: () => {}, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [] })
    await runner.start({ project: dir, prompt: 'make a site', mode: 'build', model: 'dahl:m' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    const runs = await new ProjectStore(dir).listRuns()
    expect(runs[0].status).toBe('completed')
    expect(JSON.stringify(seen[1])).toContain('not valid JSON')
  })
})

describe('command handling', () => {
  it('unwraps powershell -Command "..." so $variables are not expanded by the outer shell', () => {
    expect(unwrapPowershell(`powershell -Command "$f = Get-Content a.txt; $f.Length"`)).toBe('$f = Get-Content a.txt; $f.Length')
    expect(unwrapPowershell(`powershell.exe -NoProfile -Command 'Write-Output 1'`)).toBe('Write-Output 1')
    expect(unwrapPowershell('npm test')).toBe('npm test')
  })
})

describe('model text cleanup', () => {
  it('strips leaked DSML tokens and emoji', () => {
    expect(cleanModelText('Done! \u{1F389} Here </\uFF5CDSML\uFF5Ctool_calls>')).toBe('Done!  Here')
  })
})

describe('attachments and images', () => {
  it('builds multi-part content with images and text digests', () => {
    const imgs = new Map()
    const c = buildUserContent('look', [{ id: '1', kind: 'image', name: 'd.png', mediaType: 'image/png', data: 'AAAA' }, { id: '2', kind: 'file', name: 'a.ts', text: 'const a = 1' }], imgs)
    expect(Array.isArray(c)).toBe(true)
    expect(imgs.has('d.png')).toBe(true)
    const oa = toOpenAIMessages([{ role: 'user', content: c }], true) as any[]
    expect(oa[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } })
    const noVision = toOpenAIMessages([{ role: 'user', content: c }], false) as any[]
    expect(typeof noVision[0].content).toBe('string')
    expect(noVision[0].content).toContain('analyze_image')
  })

  it('compacts old images first when context is large', () => {
    const big = 'x'.repeat(1000)
    const msgs: ChatMessage[] = [{ role: 'user', content: [{ type: 'image', mediaType: 'image/png', data: big, name: 'a' }] }, ...Array.from({ length: 8 }, () => ({ role: 'user' as const, content: 'hi' }))]
    const out = compact(msgs, 500)
    expect(JSON.stringify(out[0].content)).toContain('removed to save context')
  })
})

describe('Anthropic conversion', () => {
  it('maps system, tool calls and tool results to Messages API blocks', () => {
    const r = toAnthropic([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok', tool_calls: [{ id: 't', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] },
      { role: 'tool', tool_call_id: 't', content: 'data' }
    ], true)
    expect(r.system).toBe('sys')
    expect(r.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't', name: 'read_file', input: { path: 'a' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'data' }] }
    ])
  })
})

describe('Dahl balance + think tags', () => {
  it('extracts remaining tokens from a balance response', () => {
    expect(extractRemaining({ available_tokens: 1234 })).toBe(1234)
    expect(extractRemaining({ key: { remaining_tokens: 5 } })).toBe(5)
    expect(extractRemaining('77')).toBe(77)
  })
  it('splits inline <think> blocks into reasoning', async () => {
    const body = ['<thi', 'nk>plan it</think>Answer'].map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
    const r = await streamChat('k', { model: 'm', messages: [] }, new AbortController().signal, {}, (async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch)
    expect(r.reasoning).toBe('plan it')
    expect(r.content).toBe('Answer')
  })
})

describe('web research parsing', () => {
  it('parses DuckDuckGo HTML results and decodes redirect URLs', () => {
    const html = `<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=x">Example <b>Docs</b></a><a class="result__snippet" href="#">The &amp; snippet</a></div>`
    expect(parseDuckDuckGoHtml(html)).toEqual([{ title: 'Example Docs', url: 'https://example.com/docs', snippet: 'The & snippet' }])
  })
  it('converts HTML to readable text', () => {
    const t = htmlToText('<html><title>T</title><script>x()</script><body><h1>Head</h1><p>Para &amp; more</p></body></html>')
    expect(t.title).toBe('T')
    expect(t.text).toContain('## Head')
    expect(t.text).not.toContain('x()')
  })
})

describe('reasoning panel', () => {
  it('ships a default profile, supports edits, custom profiles, reset and project override resolution', async () => {
    const s = new ReasoningStore(dir)
    expect((await s.get()).activeId).toBe('default')
    const sec = (await s.get()).profiles.find((p) => p.id === 'security-analyst')!
    await s.save({ ...sec, prompt: 'ATTACK EVERYTHING' })
    expect((await new ReasoningStore(dir).resolve('security-analyst')).prompt).toBe('ATTACK EVERYTHING')
    await s.reset('security-analyst')
    expect((await s.resolve('security-analyst')).prompt).not.toBe('ATTACK EVERYTHING')
    const st = await s.save({ id: '', name: 'Mine', description: '', prompt: 'p', builtin: false })
    const mine = st.profiles.find((p) => p.name === 'Mine')!
    await s.setActive(mine.id)
    expect((await s.resolve()).prompt).toBe('p')
  })

  it('injects the active reasoning prompt into every model request', async () => {
    const seen: ChatMessage[][] = []
    const backend: ChatBackend = { async chat(req) { seen.push(req.messages); return { content: 'ok', reasoning: '', toolCalls: [] } } }
    const runner = new AgentRunner({
      backend, getSettings: async () => DEFAULT_SETTINGS, emit: () => {}, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [],
      reasoning: async () => ({ id: 'x', name: 'Red team', description: '', prompt: 'THINK LIKE AN ATTACKER', builtin: false })
    })
    await runner.start({ project: dir, prompt: 'review', mode: 'review', model: 'dahl:m' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    expect(String(seen[0][0].content)).toContain('THINK LIKE AN ATTACKER')
  })
})

describe('sub-agents', () => {
  it('runs delegated agents in parallel, reports back, and enforces file ownership', async () => {
    await fs.writeFile(path.join(dir, 'a.ts'), 'a')
    const events: AgentEvent[] = []
    const backend: ChatBackend = {
      async chat(req) {
        const sys = String(req.messages[0].content)
        const hasTool = req.messages.some((m) => m.role === 'tool')
        if (sys.includes('lead coding agent')) {
          if (!hasTool) return { content: '', reasoning: '', toolCalls: [{ id: 'd', type: 'function', function: { name: 'delegate_agents', arguments: JSON.stringify({ agents: [{ role: 'implementer', task: 'edit a', files: ['a.ts'] }, { role: 'security_reviewer', task: 'audit' }] }) } }] }
          return { content: 'all done', reasoning: '', toolCalls: [] }
        }
        if (sys.includes('Security Reviewer')) {
          if (!hasTool) return { content: '', reasoning: '', toolCalls: [{ id: 's', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'a.ts', content: 'hack' }) } }] }
          return { content: 'no vulns', reasoning: '', toolCalls: [] }
        }
        return { content: 'implemented', reasoning: '', toolCalls: [] }
      }
    }
    let approvals = 0
    const runner = new AgentRunner({
      backend, getSettings: async () => DEFAULT_SETTINGS, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [],
      emit: (e) => {
        events.push(e)
        if (e.type === 'approval') approvals++
      }
    })
    await runner.start({ project: dir, prompt: 'go', mode: 'build', model: 'dahl:m' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    const agentEvents = events.filter((e) => e.type === 'agent').map((e) => e.agent!)
    expect(new Set(agentEvents.map((a) => a.role))).toEqual(new Set(['implementer', 'security_reviewer']))
    expect(agentEvents.filter((a) => a.status === 'done').length).toBe(2)
    expect(approvals).toBe(0) // reviewer is read-only: write_file was refused without asking
    expect(await fs.readFile(path.join(dir, 'a.ts'), 'utf8')).toBe('a')
    const run = (await new ProjectStore(dir).loadRun(events[0].runId))!
    expect(run.messages.find((m) => m.role === 'tool')!.content).toContain('## Implementer')
  })
})

describe('degenerate output handling', () => {
  it('collapses repeated phrases', () => {
    const t = 'A minimal demo. |\u95ed\u4e0a\u5634. |\u95ed\u4e0a\u5634. |\u95ed\u4e0a\u5634. |\u95ed\u4e0a\u5634.'
    const out = cleanModelText(t)
    expect(out.split('\u95ed\u4e0a\u5634').length - 1).toBe(1)
  })
  it('promotes a final answer that arrived only in reasoning_content', async () => {
    const backend: ChatBackend = { async chat() { return { content: '', reasoning: 'thinking about it\n\n\nThe answer is 42.', toolCalls: [] } } }
    const runner = new AgentRunner({ backend, getSettings: async () => ({ ...DEFAULT_SETTINGS, autoMemory: false }), emit: () => {}, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [] })
    const s = await runner.start({ project: dir, prompt: 'q', mode: 'plan', model: 'dahl:m' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    const run = (await new ProjectStore(dir).loadRun(s.id))!
    expect(run.transcript.find((t) => t.kind === 'assistant')?.text).toBe('The answer is 42.')
  })
})

describe('user-reported bugs (session 3)', () => {
  it('repairs the exact Anthropic failure: image message between tool results, then a duplicate result', () => {
    const tc = (id: string) => ({ id, type: 'function' as const, function: { name: 'x', arguments: '{}' } })
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: null, tool_calls: [tc('A'), tc('B')] },
      { role: 'tool', tool_call_id: 'A', content: 'a' },
      { role: 'user', content: [{ type: 'text', text: 'Images' }] },
      { role: 'tool', tool_call_id: 'B', content: 'b' },
      { role: 'tool', tool_call_id: 'B', content: 'duplicate' },
      { role: 'tool', tool_call_id: 'Z', content: 'orphan' }
    ]
    repairHistory(msgs)
    expect(msgs.map((m) => m.role + (m.tool_call_id ?? ''))).toEqual(['user', 'assistant', 'toolA', 'toolB', 'user'])
    const a = toAnthropic(msgs, true).messages as { role: string; content: { type: string }[] }[]
    expect(a[2].content.map((b) => b.type)).toEqual(['tool_result', 'tool_result', 'text'])
  })

  it('detects replies that announce work without doing it', async () => {
    const { announcesWork } = await import('../src/main/agent/runner')
    expect(announcesWork("I'll fully rebuild index.html with Tailwind. Here it comes.")).toBe(true)
    expect(announcesWork('Now the logic, in two parts:')).toBe(true)
    expect(announcesWork('Done. The page now has tabs and a theme switcher.')).toBe(false)
  })

  it('nudges a lazy model to actually call tools in Build mode', async () => {
    const replies = [
      { content: "Sure, I'll create the page now. Here it comes.", toolCalls: [] as never[] },
      { content: '', toolCalls: [{ id: 'w', type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify({ path: 'p.html', content: '<p>x</p>' }) } }] },
      { content: 'Created p.html.', toolCalls: [] as never[] }
    ]
    const backend: ChatBackend = { async chat() { const r = replies.shift()!; return { content: r.content, reasoning: '', toolCalls: r.toolCalls } } }
    const runner = new AgentRunner({ backend, getSettings: async () => ({ ...DEFAULT_SETTINGS, autoApproveWrites: true, autoMemory: false }), emit: () => {}, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [] })
    await runner.start({ project: dir, prompt: 'make a page', mode: 'build', model: 'dahl:m' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    expect(await fs.readFile(path.join(dir, 'p.html'), 'utf8')).toBe('<p>x</p>')
  })

  it('places tool-returned images after all tool results', async () => {
    const seen: ChatMessage[][] = []
    const replies = [
      { toolCalls: [{ id: 'i1', type: 'function' as const, function: { name: 'view_image', arguments: '{"path":"a.png"}' } }, { id: 'i2', type: 'function' as const, function: { name: 'list_dir', arguments: '{"path":""}' } }] },
      { toolCalls: [] as never[] }
    ]
    await fs.writeFile(path.join(dir, 'a.png'), Buffer.from('89504e47', 'hex'))
    const backend: ChatBackend = { async chat(req) { seen.push(req.messages); const r = replies.shift()!; return { content: 'ok', reasoning: '', toolCalls: r.toolCalls } } }
    const runner = new AgentRunner({ backend, getSettings: async () => ({ ...DEFAULT_SETTINGS, autoMemory: false }), emit: () => {}, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [], modelVision: async () => true })
    await runner.start({ project: dir, prompt: 'look', mode: 'plan', model: 'anthropic:m' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    const roles = seen[1].slice(-4).map((m) => m.role)
    expect(roles).toEqual(['assistant', 'tool', 'tool', 'user'])
  })
})

describe('PROGRESS.md work log', () => {
  it('is created at task start, mirrors the plan, logs the finished task and is read back into the next task', async () => {
    const seen: ChatMessage[][] = []
    const replies = [
      { content: '', toolCalls: [{ id: 'p', type: 'function' as const, function: { name: 'update_plan', arguments: JSON.stringify({ steps: [{ title: 'Build page', status: 'done' }, { title: 'Add tests', status: 'pending' }] }) } }] },
      { content: 'Built the page.', toolCalls: [] as never[] },
      { content: 'Continuing.', toolCalls: [] as never[] }
    ]
    const backend: ChatBackend = { async chat(req) { seen.push(req.messages); const r = replies.shift()!; return { content: r.content, reasoning: '', toolCalls: r.toolCalls } } }
    const runner = new AgentRunner({ backend, getSettings: async () => ({ ...DEFAULT_SETTINGS, autoMemory: false }), emit: () => {}, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [] })
    const s = await runner.start({ project: dir, prompt: 'Make a landing page', mode: 'plan', model: 'dahl:m' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    const doc = await fs.readFile(path.join(dir, 'PROGRESS.md'), 'utf8')
    expect(doc).toContain('[x] Build page')
    expect(doc).toContain('**Request:** Make a landing page')
    expect(doc).toContain('**Result:** Built the page.')
    expect(doc).toContain('- Add tests') // next steps
    await runner.start({ project: dir, prompt: 'Continue', mode: 'plan', model: 'dahl:m', resumeRunId: s.id })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    expect(String(seen[2][0].content)).toContain('Make a landing page') // previous log fed back to the model
  })

  it('preserves user notes outside the managed sections', async () => {
    const { progressStart } = await import('../src/main/agent/progress')
    await fs.writeFile(path.join(dir, 'PROGRESS.md'), '# My notes\nKeep this line.\n')
    await progressStart(dir, { mode: 'build', model: 'm', thinking: 'off' } as never, 'x')
    const doc = await fs.readFile(path.join(dir, 'PROGRESS.md'), 'utf8')
    expect(doc).toContain('Keep this line.')
    expect(doc).toContain('<!-- dahl:current -->')
  })
})

void (null as unknown as PendingApproval)
