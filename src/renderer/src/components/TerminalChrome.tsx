import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, X } from 'lucide-react'
import type { ShellKind } from '@shared/types'
import { openPreview } from '../store'
import { createTerminal, killTerminal, setActive } from '../terminal/sessions'
import { getDefaultShell, setDefaultShell, useTerms } from '../terminal/store'

// Pieces of the terminal panel's chrome: shell icons, a tab, the new-terminal split button and the link menu.

export const SHELL_SHORT: Record<ShellKind, string> = { pwsh: 'pwsh', powershell: 'powershell', cmd: 'cmd', gitbash: 'bash' }

/** Small monochrome marks in the spirit of VS Code's terminal icons, one per shell family. */
export function ShellIcon({ kind, size = 14 }: { kind: ShellKind; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (kind === 'pwsh' || kind === 'powershell')
    return (
      <svg {...common} className={`shell-icon ${kind}`}>
        <path d="M4 2.5h10.5l-2.5 11H1.5z" fill="currentColor" fillOpacity={kind === 'pwsh' ? 0.18 : 0.08} />
        <path d="M5 5.5l2.6 2.3L4.4 10.3M7.8 10.6h3" />
      </svg>
    )
  if (kind === 'cmd')
    return (
      <svg {...common} className="shell-icon cmd">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="currentColor" fillOpacity={0.08} />
        <path d="M1.5 5h13M4.2 7.4l2 1.6-2 1.6M7.6 10.8h3.2" />
      </svg>
    )
  return (
    <svg {...common} className="shell-icon bash">
      <rect x="1.5" y="2.5" width="13" height="11" rx="3" fill="currentColor" fillOpacity={0.08} />
      <path d="M7.4 5c-.4-.4-1-.6-1.6-.6-.9 0-1.6.5-1.6 1.2 0 1.6 3.3.9 3.3 2.6 0 .7-.7 1.2-1.7 1.2-.7 0-1.3-.2-1.7-.7M5.8 3.6v7.4M9.4 10.8h3" />
    </svg>
  )
}

export function TermTab({ id, active }: { id: string; active: boolean }) {
  const m = useTerms((s) => s.meta[id])
  if (!m) return null
  const short = SHELL_SHORT[m.shell.id]
  const state = m.exited !== undefined ? `exited (${m.exited ?? '?'})` : m.running ? `running ${m.running}` : 'idle'
  return (
    <div role="tab" aria-selected={active} className={`term-tab ${active ? 'on' : ''} ${m.exited !== undefined ? 'exited' : ''}`}
      title={`${m.shell.name}: ${state}\n${m.shell.path}`}
      onClick={() => setActive(m.root, id)} onAuxClick={(e) => e.button === 1 && killTerminal(id)}>
      <ShellIcon kind={m.shell.id} />
      <span className="term-tab-name">{short}</span>
      {m.running && <span className="term-tab-cmd ellipsis">{m.running}</span>}
      {m.running && <span className="term-busy" aria-label="Running" />}
      <button className="tab-close" aria-label={`Kill terminal ${short}`} title="Kill terminal" onClick={(e) => (e.stopPropagation(), killTerminal(id))}><X size={12} /></button>
    </div>
  )
}

/** "+" opens the default shell; the chevron lists every shell found on this PC and sets the default. */
export function NewTerminalButton({ root }: { root: string }) {
  const shells = useTerms((s) => s.shells)
  const [open, setOpen] = useState(false)
  const [def, setDef] = useState(getDefaultShell())
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => void (box.current?.contains(e.target as Node) || setOpen(false))
    const esc = (e: KeyboardEvent): void => void (e.key === 'Escape' && setOpen(false))
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => (document.removeEventListener('mousedown', close), document.removeEventListener('keydown', esc))
  }, [open])
  const list = shells?.shells ?? []
  const current = list.find((s) => s.id === def) ?? list[0]
  return (
    <div className="term-new" ref={box}>
      <button className="icon-btn" title={`New terminal${current ? ` (${current.name})` : ''}  Ctrl+Shift+\``} aria-label="New terminal" onClick={() => void createTerminal(root)}><Plus size={15} /></button>
      <button className="icon-btn term-new-more" title="Choose a shell" aria-label="Choose a shell" aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown size={13} /></button>
      {open && (
        <div className="popover term-menu" role="menu">
          <div className="popover-title">New terminal</div>
          {list.map((s) => (
            <button key={s.id} role="menuitem" className="popover-item" title={s.path} onClick={() => (setOpen(false), void createTerminal(root, s.id))}>
              <ShellIcon kind={s.id} /><span className="grow">{s.name}</span>{s.id === current?.id && <span className="pill">default</span>}
            </button>
          ))}
          {!list.length && <div className="empty small">No shells found.</div>}
          {list.length > 1 && (
            <>
              <div className="popover-title">Default for +</div>
              {list.map((s) => (
                <button key={s.id} role="menuitemradio" aria-checked={s.id === current?.id} className="popover-item term-def" onClick={() => (setDefaultShell(s.id), setDef(s.id))}>
                  <span className="term-check">{s.id === current?.id && <Check size={13} />}</span>{s.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Ctrl+click on a localhost link: Preview inside the app, or the system browser. */
export function LinkMenu() {
  const menu = useTerms((s) => s.linkMenu)
  useEffect(() => {
    if (!menu) return
    const close = (): void => useTerms.setState({ linkMenu: null })
    const esc = (e: KeyboardEvent): void => void (e.key === 'Escape' && close())
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => (document.removeEventListener('mousedown', close), document.removeEventListener('keydown', esc))
  }, [menu])
  if (!menu) return null
  const done = (fn: () => void) => () => (fn(), useTerms.setState({ linkMenu: null }))
  const x = Math.min(menu.x, window.innerWidth - 220)
  const y = Math.min(menu.y, window.innerHeight - 120)
  return (
    <div className="ctx-menu" role="menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <button role="menuitem" className="ctx-item" autoFocus onClick={done(() => openPreview(menu.root, menu.url))}>Open in Preview</button>
      <button role="menuitem" className="ctx-item" onClick={done(() => window.open(menu.url))}>Open in browser</button>
      <button role="menuitem" className="ctx-item" onClick={done(() => void navigator.clipboard.writeText(menu.url))}>Copy link</button>
    </div>
  )
}
