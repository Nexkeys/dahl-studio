import { execFile } from 'node:child_process'
import { spawn, type IPty } from 'node-pty'
import { FlowControl } from '@shared/pty'
import type { HostIn, HostOut } from './protocol'

/**
 * PTY host: runs in an Electron utilityProcess (like VS Code's Pty Host), so node-pty, which is not thread safe and
 * blocks on ConPTY calls, never stalls the main process. One host serves every terminal of every project.
 * Output is coalesced for a few milliseconds per terminal and flow-controlled with watermarks and ACKs.
 */

interface Term {
  pty: IPty
  flow: FlowControl
  buf: string
  timer: NodeJS.Timeout | null
  killed: boolean
}

const port = process.parentPort
const terms = new Map<string, Term>()
const post = (m: HostOut): void => port.postMessage(m)

function flush(id: string, t: Term): void {
  t.timer = null
  if (!t.buf) return
  const data = t.buf
  t.buf = ''
  post({ t: 'data', id, data })
  if (t.flow.sent(data.length)) t.pty.pause()
}

function create(m: Extract<HostIn, { t: 'create' }>): void {
  if (terms.has(m.id)) return
  let p: IPty
  try {
    p = spawn(m.file, m.args, { name: 'xterm-256color', cols: m.cols, rows: m.rows, cwd: m.cwd, env: m.env, useConpty: true })
  } catch (e) {
    post({ t: 'data', id: m.id, data: `\x1b[31mCould not start ${m.file}: ${(e as Error).message}\x1b[0m\r\n` })
    post({ t: 'exit', id: m.id, code: -1 })
    return
  }
  const t: Term = { pty: p, flow: new FlowControl(), buf: '', timer: null, killed: false }
  terms.set(m.id, t)
  p.onData((d) => {
    t.buf += d
    if (t.buf.length > 64_000) flush(m.id, t)
    else t.timer ??= setTimeout(() => flush(m.id, t), 5)
  })
  p.onExit(({ exitCode }) => {
    if (t.timer) clearTimeout(t.timer)
    flush(m.id, t)
    terms.delete(m.id)
    post({ t: 'exit', id: m.id, code: exitCode })
  })
  post({ t: 'created', id: m.id, pid: p.pid })
}

/**
 * Kill the shell and everything it started. kill(signal) throws on Windows; pty.kill() closes the pseudoconsole,
 * and taskkill /T /F first takes down child trees (a dev server started from the shell) that could outlive it.
 */
function kill(id: string): void {
  const t = terms.get(id)
  if (!t || t.killed) return
  t.killed = true
  const close = (): void => {
    try {
      t.pty.kill()
    } catch {
      /* already gone */
    }
  }
  if (process.platform !== 'win32') return close()
  const timer = setTimeout(close, 3000)
  execFile('taskkill', ['/PID', String(t.pty.pid), '/T', '/F'], { windowsHide: true }, () => {
    clearTimeout(timer)
    close()
  })
}

port.on('message', (e) => {
  const m = e.data as HostIn
  const t = 'id' in m ? terms.get(m.id) : undefined
  switch (m.t) {
    case 'create': return create(m)
    case 'write': return void t?.pty.write(m.data)
    case 'resize':
      try {
        t?.pty.resize(m.cols, m.rows)
      } catch {
        /* the shell exited between the panel's resize and this message */
      }
      return
    case 'ack': if (t?.flow.acked(m.chars)) t.pty.resume(); return
    case 'kill': return kill(m.id)
    case 'killAll': for (const id of [...terms.keys()]) kill(id); return
  }
})

post({ t: 'ready' })
