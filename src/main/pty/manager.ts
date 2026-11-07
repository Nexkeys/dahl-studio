import { app, utilityProcess, type UtilityProcess } from 'electron'
import type { PtyEvent, ShellInfo } from '@shared/types'
import { clampDims } from '@shared/pty'
import hostPath from './host?modulePath'
import type { HostIn, HostOut } from './protocol'
import { ptyEnv, shellArgs } from './launch'

/**
 * Main-process side of the integrated terminal: starts the PTY host on first use, routes the panel's calls to it
 * and its output back to the window. Sessions live as long as the app (switching projects only hides them);
 * the renderer kills a project's terminals when the project closes.
 */
export class PtyManager {
  private host: UtilityProcess | null = null
  private sessions = new Map<string, string>() // id -> project root

  constructor(private readonly emit: (e: PtyEvent) => void, private readonly log: (msg: string) => void) {}

  private ensureHost(): UtilityProcess {
    if (this.host) return this.host
    const h = utilityProcess.fork(hostPath, [], { serviceName: 'Dahl Studio Terminal Host', stdio: 'pipe' })
    h.stderr?.on('data', (d: Buffer) => this.log(`pty host: ${d.toString('utf8').slice(0, 2000)}`))
    h.on('message', (m: HostOut) => this.onHost(m))
    h.on('exit', (code) => {
      if (this.host !== h) return
      this.host = null
      if (this.sessions.size) this.log(`pty host exited (${code}) with ${this.sessions.size} terminal(s) open`)
      for (const id of this.sessions.keys()) {
        this.emit({ id, type: 'data', data: '\r\n\x1b[31mThe terminal host stopped.\x1b[0m\r\n' })
        this.emit({ id, type: 'exit', code: null })
      }
      this.sessions.clear()
    })
    this.host = h
    return h
  }

  private onHost(m: HostOut): void {
    if (m.t === 'data') this.emit({ id: m.id, type: 'data', data: m.data })
    else if (m.t === 'exit') {
      this.sessions.delete(m.id)
      this.emit({ id: m.id, type: 'exit', code: m.code })
    }
  }

  private post(m: HostIn): void {
    this.host?.postMessage(m)
  }

  create(id: string, project: string, shell: ShellInfo, cols: number, rows: number): void {
    if (this.sessions.has(id)) throw new Error('Terminal already exists.')
    const h = this.ensureHost()
    this.sessions.set(id, project)
    const env = ptyEnv(shell, app.getVersion())
    h.postMessage({ t: 'create', id, file: shell.path, args: shellArgs(shell), cwd: project, env, ...clampDims(cols, rows) } satisfies HostIn)
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  list(project: string): string[] {
    const p = project.toLowerCase()
    return [...this.sessions].filter(([, root]) => root.toLowerCase() === p).map(([id]) => id)
  }

  write(id: string, data: string): void {
    if (this.sessions.has(id) && typeof data === 'string') this.post({ t: 'write', id, data: data.slice(0, 1_000_000) })
  }

  resize(id: string, cols: number, rows: number): void {
    if (this.sessions.has(id)) this.post({ t: 'resize', id, ...clampDims(cols, rows) })
  }

  ack(id: string, chars: number): void {
    if (this.sessions.has(id) && Number.isFinite(chars)) this.post({ t: 'ack', id, chars })
  }

  kill(id: string): void {
    if (this.sessions.has(id)) this.post({ t: 'kill', id })
  }

  /** The window reloaded or the app is closing: no panel owns these terminals any more. */
  killAll(): void {
    if (this.sessions.size) this.post({ t: 'killAll' })
  }

  /** App quit: kill every shell tree, then stop the host once they are gone (at most 2 s). */
  async dispose(): Promise<void> {
    const h = this.host
    if (!h) return
    this.killAll()
    const t0 = Date.now()
    while (this.sessions.size && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 50))
    h.kill()
  }
}
