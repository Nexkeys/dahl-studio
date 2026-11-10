import { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, Play, ShieldAlert, Square } from 'lucide-react'
import type { SetupFix, TermEvent } from '@shared/types'
import { api, useStore } from '../store'
import '../ui-setup.css'

/**
 * One fix for a failed setup check. A command can be copied, or (when it needs no administrator rights and a project
 * is open) run on a click in PowerShell with its output shown right here, so the user watches it. Administrator steps
 * are only shown: Dahl never runs them.
 */
export function FixCommand({ fix, onDone }: { fix: SetupFix; onDone?: () => void }) {
  const root = useStore((s) => s.settings?.activeProject ?? null)
  const notify = useStore.getState().notify
  const [run, setRun] = useState<{ id: string; out: string; code?: number | null } | null>(null)
  const box = useRef<HTMLPreElement>(null)
  const running = !!run && run.code === undefined

  useEffect(() => {
    if (!run?.id || run.code !== undefined) return
    return api.on('term:event', (e: TermEvent) => {
      if (e.id !== run.id) return
      if (e.type === 'exit') {
        setRun((r) => r && { ...r, code: e.code ?? null })
        onDone?.()
      } else setRun((r) => r && { ...r, out: (r.out + (e.data ?? '')).slice(-20000) })
    })
  }, [run?.id, run?.code, onDone])
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [run?.out])

  const start = async () => {
    if (!fix.command || !root) return
    const id = `fix-${Date.now()}`
    setRun({ id, out: '' })
    try {
      await api.invoke('term:start', id, fix.command, root)
    } catch (e) {
      setRun(null)
      notify((e as Error).message, 'error')
    }
  }
  const copy = () => void navigator.clipboard.writeText(fix.command ?? '').then(() => notify('Command copied'))

  return (
    <div className="fix">
      <div className="fix-label">{fix.admin && <span className="pill warn"><ShieldAlert size={11} /> Administrator step: you do this</span>} {fix.label}
        {fix.url && <> <a href={fix.url} target="_blank" rel="noreferrer">{fix.url.replace(/^https:\/\//, '').slice(0, 60)} <ExternalLink size={11} /></a></>}
      </div>
      {fix.command && (
        <div className="fix-cmd">
          <code>{fix.command}</code>
          <button className="icon-btn" title="Copy command" aria-label="Copy command" onClick={copy}><Copy size={13} /></button>
          {!fix.admin && (running
            ? <button className="btn small ghost" onClick={() => api.invoke('term:stop', run!.id)}><Square size={12} /> Stop</button>
            : <button className="btn small ghost" disabled={!root} title={root ? 'Run it now in PowerShell; the output shows below' : 'Open a project to run commands from here, or copy it'} onClick={() => void start()}><Play size={12} /> Run</button>)}
        </div>
      )}
      {run && (
        <pre className="mini-pre logs" ref={box}>{run.out || 'Starting...'}{run.code !== undefined ? `\n[exited with code ${run.code ?? 'unknown'}]` : ''}</pre>
      )}
    </div>
  )
}
