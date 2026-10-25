import { useEffect, useRef, useState } from 'react'
import { Square, Trash2, ChevronRight } from 'lucide-react'
import type { TermEvent } from '@shared/types'
import { api, useStore } from '../store'

interface Line {
  kind: 'cmd' | 'out' | 'err' | 'exit'
  text: string
}

/**
 * Command terminal: each command runs in PowerShell in the project root with streamed output.
 * Not a full PTY (interactive programs that need a TTY are not supported).
 */
export function TerminalPanel({ root }: { root: string }) {
  const [lines, setLines] = useState<Line[]>([])
  const [cmd, setCmd] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [hIdx, setHIdx] = useState(-1)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return api.on('term:event', (e: TermEvent) => {
      if (!e.id.startsWith(`t-${root}`)) return
      if (e.type === 'exit') {
        setRunning(null)
        setLines((l) => [...l, { kind: 'exit', text: `Process exited with code ${e.code ?? 'unknown'}` }])
      } else setLines((l) => [...l.slice(-3000), { kind: e.type, text: e.data ?? '' }])
    })
  }, [root])

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines])

  const run = async () => {
    const c = cmd.trim()
    if (!c || running) return
    const id = `t-${root}-${Date.now()}`
    setLines((l) => [...l, { kind: 'cmd', text: c }])
    setHistory((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50))
    setHIdx(-1)
    setCmd('')
    setRunning(id)
    try {
      await api.invoke('term:start', id, c, root)
    } catch (e) {
      setRunning(null)
      useStore.getState().notify((e as Error).message, 'error')
    }
  }

  return (
    <div className="panel terminal">
      <div className="panel-head">
        <span className="panel-title">Terminal</span>
        <span className="muted small">PowerShell in project root</span>
        <div className="row-actions">
          {running && <button className="btn small ghost" onClick={() => api.invoke('term:stop', running)}><Square size={12} /> Stop</button>}
          <button className="icon-btn" title="Clear" aria-label="Clear terminal" onClick={() => setLines([])}><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="term-out" ref={box} onClick={() => document.getElementById('term-input')?.focus()}>
        {lines.map((l, i) => (
          <div key={i} className={`term-line ${l.kind}`}>{l.kind === 'cmd' ? `> ${l.text}` : l.text}</div>
        ))}
        <div className="term-input-row">
          <ChevronRight size={13} />
          <input id="term-input" value={cmd} disabled={!!running} spellCheck={false} aria-label="Terminal command"
            placeholder={running ? 'Running' : 'Type a command and press Enter'}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
              if (e.key === 'ArrowUp' && history.length) {
                const i = Math.min(hIdx + 1, history.length - 1)
                setHIdx(i)
                setCmd(history[i])
              }
              if (e.key === 'ArrowDown') {
                const i = hIdx - 1
                setHIdx(Math.max(i, -1))
                setCmd(i >= 0 ? history[i] : '')
              }
            }} />
        </div>
      </div>
    </div>
  )
}
