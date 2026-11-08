import { useEffect, useRef } from 'react'
import { Eraser, Globe, Maximize2, Minimize2, RotateCcw, Square, Trash2, X } from 'lucide-react'
import { openPreview, useStore } from '../store'
import { panels } from '../layout'
import { clearTerminal, createTerminal, fitActive, initTerminals, killTerminal, loadShells, mountHost, runCommand, sendInterrupt, takePendingNew, unmountHost } from '../terminal/sessions'
import { dismissWasRunning, EMPTY_ROOT, takeWasRunning, useTerms } from '../terminal/store'
import { LinkMenu, NewTerminalButton, TermTab } from './TerminalChrome'
import '../ui-terminal.css'

initTerminals()

const hostOf = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

function setMaximized(on: boolean): void {
  const ed = panels.editor
  try {
    if (on) ed?.collapse()
    else if (ed?.isCollapsed()) ed.expand()
  } catch {
    /* the workspace layout is being torn down */
  }
  useTerms.setState({ maximized: on })
}

/**
 * Integrated terminal: real shells (PowerShell 7, Windows PowerShell, Command Prompt, Git Bash) in a PTY, drawn by
 * xterm.js in the colours of the active theme. Terminals are per project and keep running while the panel is
 * hidden or another project is shown.
 */
export function TerminalPanel({ root }: { root: string }) {
  const body = useRef<HTMLDivElement>(null)
  const r = useTerms((s) => s.roots[root] ?? EMPTY_ROOT)
  const active = useTerms((s) => (r.active ? s.meta[r.active] : undefined))
  const devUrl = useTerms((s) => {
    if (r.active && s.meta[r.active]?.devUrl) return s.meta[r.active].devUrl
    for (const id of r.ids) if (s.meta[id]?.devUrl) return s.meta[id].devUrl
    return null
  })
  const wasRunning = useTerms((s) => s.wasRunning[root])
  const maximized = useTerms((s) => s.maximized)

  useEffect(() => {
    const el = body.current
    if (!el) return
    takeWasRunning(root)
    mountHost(root, el)
    if (takePendingNew(root) || !(useTerms.getState().roots[root]?.ids.length)) void createTerminal(root)
    else void loadShells().catch(() => {})
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => fitActive(root))
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      unmountHost(root, el)
      if (useTerms.getState().maximized) setMaximized(false)
    }
  }, [root])

  const live = active && active.exited === undefined ? active : undefined
  const canStop = !!live && (!!live.running || !live.integrated)
  const hide = () => useStore.getState().set({ showTerminal: false })

  return (
    <div className="panel terminal">
      <div className="panel-head term-head">
        <div className="term-tabs" role="tablist" aria-label="Terminals">
          {r.ids.map((id) => <TermTab key={id} id={id} active={id === r.active} />)}
        </div>
        <NewTerminalButton root={root} />
        <span className="grow" />
        <div className="row-actions">
          {devUrl && <button className="btn small ghost term-preview" title={`Open ${devUrl} in Preview`} onClick={() => openPreview(root, devUrl)}><Globe size={12} /> <span className="ellipsis">Open {hostOf(devUrl)} in Preview</span></button>}
          {canStop && <button className="btn small ghost" title={live.running ? `Stop ${live.running} (Ctrl+C)` : 'Send Ctrl+C'} onClick={() => sendInterrupt(live.id)}><Square size={11} /> Stop</button>}
          <button className="icon-btn" title="Clear" aria-label="Clear terminal" disabled={!active} onClick={() => active && clearTerminal(active.id)}><Eraser size={14} /></button>
          <button className="icon-btn danger" title="Kill terminal" aria-label="Kill terminal" disabled={!active} onClick={() => active && killTerminal(active.id)}><Trash2 size={14} /></button>
          <button className="icon-btn" title={maximized ? 'Restore panel size' : 'Maximise panel'} aria-label={maximized ? 'Restore panel size' : 'Maximise panel'} onClick={() => setMaximized(!maximized)}>
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button className="icon-btn" title="Hide terminal (Ctrl+J)" aria-label="Hide terminal" onClick={hide}><X size={15} /></button>
        </div>
      </div>
      <div className="term-body">
        {/* xterm.js elements are moved in and out of this node by sessions.ts, so React never renders into it */}
        <div className="term-xterms" ref={body} />
        {wasRunning && (
          <div className="term-resume term-resume-float">
            <RotateCcw size={13} /><span><code>{wasRunning}</code> was running when Dahl Studio closed.</span>
            <button className="btn small primary" onClick={() => (dismissWasRunning(root), void runCommand(root, wasRunning))}>Run again</button>
            <button className="btn small ghost" onClick={() => dismissWasRunning(root)}>Dismiss</button>
          </div>
        )}
        {!r.ids.length && (
          <div className="term-empty">
            <span className="muted">No terminal open.</span>
            <button className="btn small" onClick={() => void createTerminal(root)}>New terminal</button>
            <span className="muted small">Ctrl+Shift+`</span>
          </div>
        )}
      </div>
      <LinkMenu />
    </div>
  )
}
