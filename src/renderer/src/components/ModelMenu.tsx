import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Cpu, Eye, KeyRound, Laptop, RefreshCw, Search, Sparkles, Wrench } from 'lucide-react'
import type { LocalProviderStatus, ModelInfo, ProviderId } from '@shared/types'
import { buildModelMenu, moveHighlight, pushRecent, selectableRows, type MenuRow, type ModelBadge } from '@shared/modelMenu'
import { contextLabel, PROVIDER_NAME } from '@shared/models'
import { api, loadModels, updateSettings, useStore } from '../store'
import '../ui-models.css'

const NO_RECENT: string[] = []
const BADGE: Record<ModelBadge, { label: string; icon?: typeof Eye; title: string }> = {
  vision: { label: 'Vision', icon: Eye, title: 'Accepts images' },
  tools: { label: 'Tools', icon: Wrench, title: 'Native tool calling (what the agent uses to read, edit and run)' },
  free: { label: 'Free', title: 'Free to use (an OpenRouter free variant or zero pricing)' },
  local: { label: 'Local', icon: Laptop, title: 'Runs on this PC' },
  new: { label: 'New', icon: Sparkles, title: 'Appeared in the last 7 days' }
}

/** The model button in the composer bar and its searchable popover (providers collapsed, recent models first). */
export function ModelMenu() {
  const models = useStore((s) => s.models)
  const current = useStore((s) => s.settings?.defaultModel ?? null)
  const recentSetting = useStore((s) => s.settings?.recentModels) ?? NO_RECENT
  const keys = useStore((s) => s.keys)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ProviderId[]>([])
  const [hl, setHl] = useState<string | null>(null)
  const [local, setLocal] = useState<LocalProviderStatus[]>([])
  const [place, setPlace] = useState<{ bottom: number; left: number; width: number }>({ bottom: 44, left: 8, width: 420 })
  const [busy, setBusy] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const model = models.find((m) => m.key === current)
  const recent = useMemo(() => (recentSetting.length ? recentSetting : current ? [current] : NO_RECENT), [recentSetting, current])
  const rows = useMemo(() => buildModelMenu({ models, query, expanded, recent, keys, local }), [models, query, expanded, recent, keys, local])

  const show = () => {
    // placed against the composer (the chat panel clips anything wider), just above the button
    const box = wrap.current?.closest('.composer') as HTMLElement | null
    const b = btn.current?.getBoundingClientRect()
    if (box && b) {
      const r = box.getBoundingClientRect()
      const width = Math.min(440, r.width - 16)
      setPlace({ bottom: r.bottom - b.top + 6, left: Math.max(8, Math.min(b.left - r.left, r.width - width - 8)), width })
    }
    setQuery('')
    setOpen(true)
    void api.invoke<{ local?: LocalProviderStatus[] }>('models:list').then((l) => setLocal(l.local ?? [])).catch(() => {})
  }
  const close = (focus = true) => {
    setOpen(false)
    if (focus) btn.current?.focus()
  }

  // highlight the chosen model when opening, the first hit while searching
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const sel = selectableRows(rows)
    const pick = query ? sel.find((r) => r.kind === 'model') : sel.find((r) => r.kind === 'model' && r.model.key === current)
    setHl((pick ?? sel[0])?.id ?? null)
  }, [open, query])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  useEffect(() => {
    if (hl) list.current?.querySelector(`[data-row="${CSS.escape(hl)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hl])

  const pick = (m: ModelInfo) => {
    close()
    void updateSettings({ defaultModel: m.key, recentModels: pushRecent(useStore.getState().settings?.recentModels, m.key) })
  }
  const toggle = (p: ProviderId, to?: boolean) => setExpanded((e) => ((to ?? !e.includes(p)) ? [...e.filter((x) => x !== p), p] : e.filter((x) => x !== p)))
  const activate = (r: MenuRow | undefined) => {
    if (!r || r.kind === 'section') return
    if (r.kind === 'model') return pick(r.model)
    // a provider with nothing to offer: its key or server is set up in Settings
    if (!r.total) {
      close(false)
      return useStore.getState().set({ view: 'settings' })
    }
    if (!query) toggle(r.provider)
  }
  const refresh = async () => {
    setBusy(true)
    await loadModels(true)
    await api.invoke<{ local?: LocalProviderStatus[] }>('models:list').then((l) => setLocal(l.local ?? [])).catch(() => {})
    setBusy(false)
  }
  const onKey = (e: React.KeyboardEvent) => {
    const row = rows.find((r) => r.id === hl)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setHl(moveHighlight(rows, hl, e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      setHl(moveHighlight(rows, hl, e.key === 'PageDown' ? 8 : -8))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(row)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (!query && e.key === 'ArrowRight' && row?.kind === 'provider' && !row.expanded) {
      e.preventDefault()
      toggle(row.provider, true)
    } else if (!query && e.key === 'ArrowLeft' && row && row.kind !== 'section') {
      const p = row.kind === 'provider' ? row.provider : row.recent ? null : row.model.provider
      if (!p || (row.kind === 'provider' && !row.expanded)) return
      e.preventDefault()
      toggle(p, false)
      setHl(`provider:${p}`)
    }
  }

  return (
    <div className="model-menu" ref={wrap}>
      <button ref={btn} className={`tool-toggle model-btn ${open ? 'on' : ''}`} onClick={() => (open ? close() : show())} aria-haspopup="listbox" aria-expanded={open}
        title={model ? `${PROVIDER_NAME[model.provider]}: ${model.id}` : 'Choose a model'}>
        <Cpu size={13} /><span className="model-btn-label">{model?.label ?? (models.length ? 'Choose a model' : 'Loading models')}</span><ChevronDown size={12} />
      </button>
      {open && (
        <div className="popover model-pop" role="dialog" aria-label="Choose a model" style={{ bottom: place.bottom, left: place.left, width: place.width }}>
          <div className="model-search">
            <Search size={13} />
            <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Search models and providers (try free, vision, local)"
              role="combobox" aria-expanded aria-controls="model-menu-list" aria-activedescendant={hl ? `mm-${hl}` : undefined} aria-label="Search models" spellCheck={false} />
          </div>
          <div className="model-rows" id="model-menu-list" role="listbox" ref={list}>
            {rows.map((r) => <Row key={r.id} r={r} hl={hl === r.id} current={current} local={local} onPick={() => activate(r)} />)}
            {!selectableRows(rows).length && <div className="muted small pad">No model or provider matches "{query}".</div>}
          </div>
          <div className="model-foot">
            <span>Arrows to move, Enter to pick, Esc to close</span>
            <span className="grow" />
            <button className="link" onMouseDown={(e) => e.preventDefault()} onClick={() => void refresh()} disabled={busy}>{busy ? <span className="spinner" /> : <RefreshCw size={11} />} Refresh</button>
            <button className="link" onClick={() => (close(false), useStore.getState().set({ view: 'settings' }))}><KeyRound size={11} /> Keys</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ r, hl, current, local, onPick }: { r: MenuRow; hl: boolean; current: string | null; local: LocalProviderStatus[]; onPick: () => void }) {
  if (r.kind === 'section') return <div className="model-section" role="presentation">{r.label}</div>
  // mousedown keeps the focus in the search field, so the keyboard keeps working after a click
  const common = { id: `mm-${r.id}`, 'data-row': r.id, role: 'option', 'aria-selected': hl, onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onClick: onPick }
  if (r.kind === 'provider') {
    const small = r.provider === 'lmstudio' ? local.find((l) => l.provider === 'lmstudio')?.smallContext : undefined
    return (
      <>
        <div {...common} aria-expanded={r.expanded} className={`model-prow ${hl ? 'hl' : ''}`} title={r.total ? undefined : 'Set it up in Settings'}>
          {r.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <b>{r.name}</b>
          <span className="count">{r.count === r.total ? r.total : `${r.count} of ${r.total}`} {r.total === 1 ? 'model' : 'models'}</span>
          <span className={`access ${r.access}`}>{r.accessLabel}</span>
        </div>
        {small && r.expanded && <div className="model-warn">Loaded with a {contextLabel(small)} context, too small for agent prompts. Raise Context Length in LM Studio.</div>}
      </>
    )
  }
  const m = r.model
  return (
    <div {...common} className={`model-row ${hl ? 'hl' : ''} ${m.key === current ? 'on' : ''} ${r.recent ? 'recent' : ''}`} title={`${PROVIDER_NAME[m.provider]}: ${m.id}`}>
      <span className="model-name">{m.label}</span>
      {r.recent && <span className="model-from">{PROVIDER_NAME[m.provider]}</span>}
      {m.reasoning && <Brain size={11} className="c-muted" aria-label="Reasoning model" />}
      <span className="mbadges">
        {r.badges.map((b) => {
          const B = BADGE[b]
          return <span key={b} className={`mbadge ${b}`} title={B.title}>{B.icon && <B.icon size={9} />}{B.label}</span>
        })}
      </span>
      <span className="model-ctx" title="Context window">{contextLabel(m.contextTokens)}</span>
    </div>
  )
}
