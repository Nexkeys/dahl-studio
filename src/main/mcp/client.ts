import { spawn, type ChildProcess } from 'node:child_process'
import type { McpTool } from '@shared/types'

/**
 * Minimal Model Context Protocol client (JSON-RPC 2.0).
 * Transports: STDIO (newline-delimited JSON on stdin/stdout) and Streamable HTTP (POST, JSON or SSE response,
 * Mcp-Session-Id header). Implements initialize, notifications/initialized, tools/list, tools/call.
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

export interface McpTransport {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<any>
  notify(method: string, params?: unknown): Promise<void>
  close(): void
  onClose?: (reason: string) => void
  pid?: number
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export class StdioTransport implements McpTransport {
  private proc: ChildProcess
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buf = ''
  onClose?: (reason: string) => void
  pid?: number

  constructor(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, private log: (line: string) => void) {
    this.proc = spawn(command, args, { env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' && !/\.exe$/i.test(command) && !command.includes('\\') })
    this.pid = this.proc.pid
    this.proc.stdout!.on('data', (d: Buffer) => this.onData(d.toString('utf8')))
    this.proc.stderr!.on('data', (d: Buffer) => d.toString('utf8').split(/\r?\n/).filter(Boolean).forEach((l) => this.log(`[stderr] ${l}`)))
    this.proc.on('error', (e) => this.shutdown(`failed to start: ${e.message}`))
    this.proc.on('exit', (code, sig) => this.shutdown(`process exited (code ${code ?? 'null'}${sig ? `, ${sig}` : ''})`))
  }

  private onData(s: string): void {
    this.buf += s
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        this.log(`[stdout] ${line.slice(0, 300)}`)
        continue
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.error) p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`))
        else p.resolve(msg.result)
      } else if (msg.method && msg.id !== undefined) {
        // server -> client request (e.g. roots/list, ping): answer minimally
        const result = msg.method === 'roots/list' ? { roots: [] } : {}
        this.write({ jsonrpc: '2.0', id: msg.id, result })
      }
    }
  }

  private write(obj: unknown): void {
    this.proc.stdin!.write(JSON.stringify(obj) + '\n')
  }

  private shutdown(reason: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error(`MCP server ${reason}`))
    }
    this.pending.clear()
    this.onClose?.(reason)
    this.onClose = undefined
  }

  request(method: string, params?: unknown, timeoutMs = 60000): Promise<any> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request ${method} timed out after ${timeoutMs / 1000}s`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({ jsonrpc: '2.0', id, method, params: params ?? {} })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e as Error)
      }
    })
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.write({ jsonrpc: '2.0', method, params: params ?? {} })
  }

  close(): void {
    try {
      if (process.platform === 'win32' && this.proc.pid) spawn('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], { windowsHide: true })
      else this.proc.kill()
    } catch {
      /* ignore */
    }
  }
}

export class HttpTransport implements McpTransport {
  private nextId = 1
  private session: string | null = null
  onClose?: (reason: string) => void

  constructor(private url: string, private headers: Record<string, string>) {}

  private async post(body: unknown, timeoutMs: number): Promise<any> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        ...(this.session ? { 'Mcp-Session-Id': this.session } : {}),
        ...this.headers
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.session = sid
    if (res.status === 202) return null
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const id = (body as { id?: number }).id
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue
        try {
          const m = JSON.parse(line.slice(5).trim())
          if (m.id === id) return m
        } catch {
          /* skip */
        }
      }
      return null
    }
    return text ? JSON.parse(text) : null
  }

  async request(method: string, params?: unknown, timeoutMs = 60000): Promise<any> {
    const id = this.nextId++
    const m = await this.post({ jsonrpc: '2.0', id, method, params: params ?? {} }, timeoutMs)
    if (!m) throw new Error(`No response to ${method}`)
    if (m.error) throw new Error(`MCP error ${m.error.code}: ${m.error.message}`)
    return m.result
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.post({ jsonrpc: '2.0', method, params: params ?? {} }, 15000).catch(() => null)
  }

  close(): void {
    if (this.session) void fetch(this.url, { method: 'DELETE', headers: { 'Mcp-Session-Id': this.session, ...this.headers } }).catch(() => {})
  }
}

export class McpClient {
  serverInfo: unknown = null
  constructor(public transport: McpTransport) {}

  async initialize(): Promise<void> {
    const r = await this.transport.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Dahl Studio', version: '0.3.0' } }, 90000)
    this.serverInfo = r?.serverInfo ?? null
    await this.transport.notify('notifications/initialized')
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = []
    let cursor: string | undefined
    for (let i = 0; i < 10; i++) {
      const r = await this.transport.request('tools/list', cursor ? { cursor } : {})
      for (const t of r?.tools ?? []) tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema, readOnly: !!t.annotations?.readOnlyHint, destructive: !!t.annotations?.destructiveHint })
      cursor = r?.nextCursor
      if (!cursor) break
    }
    return tools
  }

  /** Returns text content joined; images are reported as placeholders. */
  async callTool(name: string, args: unknown, timeoutMs = 120000): Promise<{ text: string; isError: boolean; images: { mediaType: string; data: string }[] }> {
    const r = await this.transport.request('tools/call', { name, arguments: args ?? {} }, timeoutMs)
    const images: { mediaType: string; data: string }[] = []
    const parts: string[] = []
    for (const c of r?.content ?? []) {
      if (c.type === 'text') parts.push(c.text)
      else if (c.type === 'image') {
        images.push({ mediaType: c.mimeType, data: c.data })
        parts.push(`[image ${c.mimeType}]`)
      } else if (c.type === 'resource') parts.push(c.resource?.text ?? `[resource ${c.resource?.uri}]`)
      else parts.push(`[${c.type}]`)
    }
    if (r?.structuredContent && !parts.length) parts.push(JSON.stringify(r.structuredContent))
    return { text: parts.join('\n'), isError: !!r?.isError, images }
  }
}
