/**
 * LIVE capability tests (real network, real MCP servers). Skipped unless DAHL_LIVE=1.
 * Run: $env:DAHL_LIVE=1; npx vitest run tests/live.test.ts
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { McpManager } from '../src/main/mcp/manager'
import { webSearch, webFetch } from '../src/main/tools/web'
import { windowsOcr } from '../src/main/tools/image'

const LIVE = !!process.env.DAHL_LIVE
const ROOT = path.resolve('.')

async function manager(dir: string): Promise<McpManager> {
  const secrets = new Map<string, string>()
  return new McpManager({
    appDir: dir,
    bundledEntry: (n) => ({ filesystem: path.join(ROOT, 'node_modules/@modelcontextprotocol/server-filesystem/dist/index.js'), playwright: path.join(ROOT, 'node_modules/@playwright/mcp/cli.js') } as Record<string, string>)[n] ?? null,
    getSecret: async (k) => secrets.get(k) ?? null,
    setSecret: async (k, v) => void secrets.set(k, v),
    onChange: () => {}
  })
}

describe.skipIf(!LIVE)('live: built-in web research', () => {
  it('DuckDuckGo search returns real results without any key', async () => {
    const r = await webSearch('Model Context Protocol specification')
    console.log('web_search:', r.slice(0, 3))
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].url).toMatch(/^https?:\/\//)
  }, 30000)
  it('web_fetch reads a page as text', async () => {
    const r = await webFetch('https://example.com')
    expect(r.text).toContain('Example Domain')
  }, 30000)
})

describe.skipIf(!LIVE)('live: Windows OCR', () => {
  it('recognises text in an image', async () => {
    const png = path.join(os.tmpdir(), 'dahl-ocr-test.png')
    // render text into a PNG with System.Drawing
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap 520,120; $g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::White); $f = New-Object System.Drawing.Font('Segoe UI',32); $g.DrawString('Dahl Studio OCR', $f, [System.Drawing.Brushes]::Black, 10, 30); $b.Save('${png}')`])
    const lines = await windowsOcr(png)
    console.log('ocr:', lines)
    expect(lines.map((l) => l.text).join(' ')).toMatch(/Dahl\s*Studio/i)
  }, 60000)
})

describe.skipIf(!LIVE)('live: MCP Free Toolbox capability tests', () => {
  const project = path.join(os.tmpdir(), 'dahl-live-proj')
  for (const id of ['filesystem', 'duckduckgo', 'playwright', 'git', 'fetch']) {
    it(`${id}: install, connect, list tools, real capability call`, async () => {
      await fs.mkdir(project, { recursive: true })
      await fs.writeFile(path.join(project, 'readme.md'), '# live')
      if (id === 'git') execFileSync('git', ['init'], { cwd: project })
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-mcp-'))
      const m = await manager(dir)
      await m.installFromCatalog(id)
      const r = await m.test(id, project)
      console.log(`${id}:`, JSON.stringify(r, null, 1).slice(0, 900))
      m.stopAll()
      expect(r.tools).toBeGreaterThan(0)
      expect(r.ok).toBe(true)
    }, 240000)
  }
  it('filesystem server refuses paths outside the project (Dahl boundary check)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-mcp-'))
    const m = await manager(dir)
    await m.installFromCatalog('filesystem')
    await expect(m.call('filesystem', project, 'read_text_file', { path: 'C:\\Windows\\win.ini' })).rejects.toThrow(/outside/)
    m.stopAll()
  }, 120000)
})
