import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, FileText, Command } from 'lucide-react'
import type { ThemeId } from '@shared/types'
import { api, openFile, updateSettings, useStore, type View } from '../store'
import { THEMES, applyTheme } from '../themes'

interface Item { id: string; label: string; hint?: string; run: () => void; file?: boolean }

export function CommandPalette() {
  const open = useStore((s) => s.palette)
  const root = useStore((s) => s.settings?.activeProject ?? null)
  const set = useStore((s) => s.set)
  const [q, setQ] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || (e.shiftKey && e.key.toLowerCase() === 'p'))) {
        e.preventDefault()
        set({ palette: !useStore.getState().palette })
      }
      if (e.key === 'Escape' && useStore.getState().palette) set({ palette: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [set])
  useEffect(() => {
    if (!open) return
    setQ('')
    setIdx(0)
    setTimeout(() => input.current?.focus(), 10)
    if (root) void api.invoke<string[]>('fs:listAll', root).then(setFiles).catch(() => setFiles([]))
  }, [open, root])

  const close = () => set({ palette: false })
  const go = (v: View) => () => (set({ view: v }), close())
  const actions: Item[] = useMemo(() => [
    { id: 'v-ws', label: 'Go to Workspace', run: go('workspace') },
    { id: 'v-git', label: 'Go to Source Control', run: go('git') },
    { id: 'v-ag', label: 'Go to Agents', run: go('agents') },
    { id: 'v-rs', label: 'Edit Reasoning profile', run: go('reasoning') },
    { id: 'v-tb', label: 'Open Free Toolbox (MCP)', run: go('toolbox') },
    { id: 'v-mem', label: 'Open Memory', run: go('memory') },
    { id: 'v-log', label: 'Open Logs', run: go('logs') },
    { id: 'v-set', label: 'Open Settings / API keys', run: go('settings') },
    { id: 'term', label: 'Toggle terminal', run: () => (set({ showTerminal: !useStore.getState().showTerminal }), close()) },
    { id: 'mode-b', label: 'Mode: Build', run: () => (set({ mode: 'build' }), close()) },
    { id: 'mode-p', label: 'Mode: Plan', run: () => (set({ mode: 'plan' }), close()) },
    { id: 'mode-r', label: 'Mode: Review', run: () => (set({ mode: 'review' }), close()) },
    ...THEMES.map((t) => ({ id: `th-${t.id}`, label: `Theme: ${t.name}`, hint: t.tagline, run: () => (applyTheme(t.id as ThemeId), void updateSettings({ theme: t.id }), close()) }))
  ], [])
  const items: Item[] = useMemo(() => {
    const lq = q.toLowerCase().trim()
    const acts = actions.filter((a) => !lq || a.label.toLowerCase().includes(lq))
    const fs = root ? files.filter((f) => !lq || f.toLowerCase().includes(lq)).slice(0, 40).map((f) => ({ id: `f-${f}`, label: f, file: true, run: () => (void openFile(root, f), close()) })) : []
    return lq ? [...fs, ...acts] : [...acts, ...fs.slice(0, 12)]
  }, [q, files, actions, root])

  if (!open) return null
  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette-input"><Search size={15} />
          <input ref={input} value={q} placeholder="Search files and commands" onChange={(e) => (setQ(e.target.value), setIdx(0))}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(i + 1, items.length - 1)))
              if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(i - 1, 0)))
              if (e.key === 'Enter') items[idx]?.run()
            }} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list">
          {items.map((it, i) => (
            <button key={it.id} className={`palette-item ${i === idx ? 'on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={it.run}>
              {it.file ? <FileText size={14} /> : <Command size={14} />}<span className="ellipsis">{it.label}</span>{it.hint && <span className="muted small ellipsis">{it.hint}</span>}
            </button>
          ))}
          {!items.length && <div className="muted small pad">No results</div>}
        </div>
      </div>
    </div>
  )
}
