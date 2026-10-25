import { spawn, type ChildProcess } from 'node:child_process'
import type { TermEvent } from '@shared/types'

/**
 * Command runner used by both the integrated terminal and the agent's run_command tool.
 * Uses the user's shell (PowerShell on Windows) without a PTY: output streams line by line,
 * processes can be stopped, and the Dahl API key is never present in the child environment.
 */
export interface RunResult {
  exitCode: number | null
  output: string
  timedOut: boolean
}

const SENSITIVE_ENV = /^(DAHL_|OPENAI_API_KEY|ANTHROPIC_API_KEY)/i

export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!SENSITIVE_ENV.test(k)) env[k] = v
  env.FORCE_COLOR = '0'
  return env
}

function shellArgs(command: string): [string, string[]] {
  if (process.platform === 'win32') return ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]]
  return ['/bin/sh', ['-c', command]]
}

export class ProcessManager {
  private procs = new Map<string, ChildProcess>()

  start(id: string, command: string, cwd: string, onEvent: (e: TermEvent) => void): void {
    const [cmd, args] = shellArgs(command)
    const child = spawn(cmd, args, { cwd, env: childEnv(), windowsHide: true })
    this.procs.set(id, child)
    child.stdout?.on('data', (d: Buffer) => onEvent({ id, type: 'out', data: d.toString('utf8') }))
    child.stderr?.on('data', (d: Buffer) => onEvent({ id, type: 'err', data: d.toString('utf8') }))
    child.on('error', (err) => onEvent({ id, type: 'err', data: `Failed to start: ${err.message}\n` }))
    child.on('close', (code) => {
      this.procs.delete(id)
      onEvent({ id, type: 'exit', code })
    })
  }

  stop(id: string): boolean {
    const p = this.procs.get(id)
    if (!p || p.pid === undefined) return false
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true })
    else p.kill('SIGTERM')
    return true
  }

  stopAll(): void {
    for (const id of [...this.procs.keys()]) this.stop(id)
  }

  /** Run to completion with a timeout; used by the agent. Output is capped. */
  run(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal, onData?: (s: string) => void): Promise<RunResult> {
    return new Promise((resolve) => {
      const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      let output = ''
      let timedOut = false
      const cap = (s: string): void => {
        onData?.(s)
        if (output.length < 60_000) output += s
      }
      const timer = setTimeout(() => {
        timedOut = true
        this.stop(id)
      }, timeoutMs)
      const onAbort = (): void => {
        this.stop(id)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.start(id, command, cwd, (e) => {
        if (e.type === 'out' || e.type === 'err') cap(e.data ?? '')
        if (e.type === 'exit') {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          resolve({ exitCode: e.code ?? null, output, timedOut })
        }
      })
    })
  }
}
