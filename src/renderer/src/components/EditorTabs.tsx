import { useEffect, useRef, useState } from 'react'
import { X, GitCompare, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { languageFor } from '../lang'

// Editor tab strip and the bar under it. Tabs reorder by drag, close with the middle button, and have a context
// menu. Closed tabs are remembered for Ctrl+Shift+T.

const closedTabs = new Map<string, string[]>()

/** Close tabs, asking once if any of them has unsaved changes. */
export function closeTabs(root: string, paths: string[]): void {
  const st = useStore.getState()
  const tabs = st.project(root).tabs.filter((t) => paths.includes(t.path))
  const dirty = tabs.filter((t) => t.content !== t.saved)
  if (dirty.length && !window.confirm(dirty.length === 1 ? `${dirty[0].path} has unsaved changes. Close anyway?` : `${dirty.length} files have unsaved changes. Close them anyway?`)) return
  if (!tabs.length) return
  closedTabs.set(root, [...(closedTabs.get(root) ?? []), ...tabs.map((t) => t.path)].slice(-20))
  st.patchProject(root, (c) => {
    const rest = c.tabs.filter((t) => !paths.includes(t.path))
    if (!c.active || !paths.includes(c.active)) return { tabs: rest }
    const i = c.tabs.findIndex((t) => t.path === c.active)
    return { tabs: rest, active: rest[Math.min(i, rest.length - 1)]?.path ?? null }
  })
}

/** The most recently closed tab that is not open again, for Ctrl+Shift+T. */
export function popClosedTab(root: string): string | null {
  const list = closedTabs.get(root) ?? []
  const open = new Set(useStore.getState().project(root).tabs.map((t) => t.path))
  while (list.length) {
    const p = list.pop()!
    if (!open.has(p)) return p
  }
  return null
}

/** Ctrl+Tab and Ctrl+Shift+Tab: move to the next or previous tab. */
export function cycleTab(root: string, step: 1 | -1): void {
  const st = useStore.getState()
  const { tabs, active } = st.project(root)
  if (tabs.length < 2) return
  const i = Math.max(0, tabs.findIndex((t) => t.path === active))
  st.patchProject(root, { active: tabs[(i + step + tabs.length) % tabs.length].path, reviewing: null })
}

// cursor position from the active Monaco editor, shown in the bar under the tabs
type Pos = { line: number; col: number; sel: number }
const cursorListeners = new Set<(p: Pos) => void>()
export function emitCursor(p: Pos): void {
  cursorListeners.forEach((l) => l(p))
}

interface Menu { x: number; y: number; path: string }

export function EditorTabs({ root, reviewPath, saveButton }: { root: string; reviewPath: string | null; saveButton: React.ReactNode }) {
  const tabs = useStore((s) => s.projects[root]?.tabs) ?? []
  const activePath = useStore((s) => s.projects[root]?.active ?? null)
  const patch = useStore((s) => s.patchProject)
  const [menu, setMenu] = useState<Menu | null>(null)
  const drag = useRef<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => (window.removeEventListener('mousedown', close), window.removeEventListener('blur', close))
  }, [menu])

  const move = (from: string, to: string) => {
    if (from === to) return
    patch(root, (c) => {
      const list = c.tabs.filter((t) => t.path !== from)
      const tab = c.tabs.find((t) => t.path === from)
      const at = list.findIndex((t) => t.path === to)
      if (!tab || at < 0) return {}
      list.splice(c.tabs.findIndex((t) => t.path === from) < c.tabs.findIndex((t) => t.path === to) ? at + 1 : at, 0, tab)
      return { tabs: list }
    })
  }

  const menuItems = (path: string): { label: string; run: () => void; off?: boolean }[] => {
    const i = tabs.findIndex((t) => t.path === path)
    return [
      { label: 'Close', run: () => closeTabs(root, [path]) },
      { label: 'Close others', run: () => closeTabs(root, tabs.filter((t) => t.path !== path).map((t) => t.path)), off: tabs.length < 2 },
      { label: 'Close to the right', run: () => closeTabs(root, tabs.slice(i + 1).map((t) => t.path)), off: i === tabs.length - 1 },
      { label: 'Close saved', run: () => closeTabs(root, tabs.filter((t) => t.content === t.saved).map((t) => t.path)) },
      { label: 'Close all', run: () => closeTabs(root, tabs.map((t) => t.path)) },
      { label: 'Copy relative path', run: () => void navigator.clipboard.writeText(path).then(() => useStore.getState().notify('Path copied')) }
    ]
  }

  return (
    <div className="tabs" role="tablist" onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}>
      {reviewPath && (
        <div className="tab active review-tab" role="tab" aria-selected>
          <GitCompare size={13} />
          <span>Review: {reviewPath}</span>
        </div>
      )}
      {tabs.map((t) => (
        <div key={t.path} role="tab" aria-selected={!reviewPath && t.path === activePath} title={t.path} draggable
          className={`tab ${!reviewPath && t.path === activePath ? 'active' : ''} ${over === t.path ? 'drop' : ''}`}
          onClick={() => patch(root, { active: t.path, reviewing: null })}
          onAuxClick={(e) => e.button === 1 && closeTabs(root, [t.path])}
          onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, path: t.path }))}
          onDragStart={(e) => ((drag.current = t.path), (e.dataTransfer.effectAllowed = 'move'))}
          onDragOver={(e) => drag.current && (e.preventDefault(), setOver(t.path))}
          onDragLeave={() => setOver((o) => (o === t.path ? null : o))}
          onDrop={(e) => (e.preventDefault(), drag.current && move(drag.current, t.path), setOver(null))}
          onDragEnd={() => ((drag.current = null), setOver(null))}>
          <span>{t.path.split('/').pop()}</span>
          {t.content !== t.saved && <span className="dirty" aria-label="unsaved" />}
          <button className="tab-close" aria-label={`Close ${t.path}`} onClick={(e) => { e.stopPropagation(); closeTabs(root, [t.path]) }}><X size={12} /></button>
        </div>
      ))}
      <div className="tabs-spacer" />
      {saveButton}
      {menu && (
        <div className="ctx-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menuItems(menu.path).map((m) => (
            <button key={m.label} role="menuitem" className="ctx-item" disabled={m.off} onClick={() => (m.run(), setMenu(null))}>{m.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Path breadcrumbs on the left; cursor position and language on the right. */
export function EditorCrumbs({ path }: { path: string }) {
  const [pos, setPos] = useState<Pos>({ line: 1, col: 1, sel: 0 })
  useEffect(() => {
    cursorListeners.add(setPos)
    return () => void cursorListeners.delete(setPos)
  }, [])
  const parts = path.split('/')
  return (
    <div className="crumbs">
      {parts.map((p, i) => (
        <span key={i} className={`crumb ${i === parts.length - 1 ? 'last' : ''}`}>{i > 0 && <ChevronRight size={11} />}{p}</span>
      ))}
      <span className="grow" />
      <span className="crumb-info">Ln {pos.line}, Col {pos.col}{pos.sel ? ` (${pos.sel} selected)` : ''}</span>
      <span className="crumb-info">{languageFor(path)}</span>
    </div>
  )
}
