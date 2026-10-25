import { useEffect, useState } from 'react'
import { KeyRound, RefreshCw, CheckCircle2, XCircle, Trash2, FolderOpen, Download, Pencil, Plus, Play, HardDrive } from 'lucide-react'
import type { MemoryEntry, RunSummary, StorageReport } from '@shared/types'
import { api, baseName, loadRunsSummary, updateSettings, useStore } from '../store'
import { loadRunIntoChat } from './ChatPanel'
import wordmarkUrl from '../assets/wordmark.png'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

// ------------------------------------------------------------------ Tasks
export function TasksView() {
  const s = useStore((st) => st.settings)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!s) return
    Promise.all(s.openProjects.map((p) => loadRunsSummary(p).catch(() => [] as RunSummary[]))).then((all) => setRuns(all.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))))
  }, [s, tick])

  const open = async (r: RunSummary) => {
    await updateSettings({ activeProject: r.project })
    await loadRunIntoChat(r.project, r.id)
    useStore.getState().set({ view: 'workspace' })
  }
  const del = async (r: RunSummary) => {
    if (!window.confirm('Delete this task and its checkpoint? Project files are not affected.')) return
    try {
      await api.invoke('agent:deleteRun', r.project, r.id)
      setTick((t) => t + 1)
    } catch (e) {
      useStore.getState().notify((e as Error).message, 'error')
    }
  }

  return (
    <div className="view">
      <h1>Tasks</h1>
      <p className="muted small">Every conversation is a task with a durable checkpoint in the project's <code>.dahl/runs</code> folder. Interrupted tasks are never resumed automatically: open one to inspect it, then press Continue.</p>
      <button className="btn ghost small" onClick={() => setTick((t) => t + 1)}><RefreshCw size={13} /> Refresh</button>
      {!runs.length && <div className="empty-state compact"><div className="muted">No tasks yet. Start one from the Dahl chat panel.</div></div>}
      <div className="list">
        {runs.map((r) => (
          <div key={r.project + r.id} className="list-row">
            <span className={`run-badge ${r.status}`}>{r.status.replace('_', ' ')}</span>
            <div className="grow">
              <div className="ellipsis">{r.objective}</div>
              <div className="muted small">{baseName(r.project)} · {r.mode} · {new Date(r.updatedAt).toLocaleString()} · {r.changedFiles.length} files changed</div>
            </div>
            <button className="btn small ghost" onClick={() => open(r)}><Play size={13} /> Open</button>
            <button className="icon-btn danger" aria-label="Delete task" onClick={() => del(r)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Memory
export function MemoryView() {
  const s = useStore((st) => st.settings)
  const root = s?.activeProject
  const [items, setItems] = useState<MemoryEntry[]>([])
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const notify = useStore.getState().notify

  const load = () => root && api.invoke<MemoryEntry[]>('memory:list', root).then(setItems).catch((e) => notify(e.message, 'error'))
  useEffect(() => {
    void load()
  }, [root])

  if (!root) return <div className="view"><h1>Memory</h1><div className="muted">Open a project to see its memory.</div></div>

  const persist = async (next: MemoryEntry[]) => {
    await api.invoke('memory:save', root, next)
    setItems(next)
  }
  const add = async () => {
    if (!draft.trim()) return
    await api.invoke('memory:add', root, draft, [])
    setDraft('')
    void load()
  }
  const exportMd = () => {
    const blob = new Blob([items.map((i) => `- ${i.text}`).join('\n') + '\n'], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${baseName(root)}-dahl-memory.md`
    a.click()
  }

  return (
    <div className="view">
      <h1>Memory · {baseName(root)}</h1>
      <p className="muted small">Stored locally in <code>{root}\.dahl\memory.json</code> (mirrored to memory.md). Only entries relevant to the current request are included in what is sent to Dahl's API; entries tagged <code>pinned</code> are always included.</p>
      <div className="row">
        <input className="input grow" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a project fact, convention or decision" onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn primary" onClick={add}><Plus size={14} /> Add</button>
        <button className="btn ghost" onClick={exportMd} disabled={!items.length}><Download size={14} /> Export</button>
        <button className="btn ghost danger-text" disabled={!items.length} onClick={() => window.confirm('Clear all memory for this project?') && persist([])}>Clear</button>
      </div>
      {!items.length && <div className="empty-state compact"><div className="muted">No memory yet. Dahl saves durable facts here as it works, or add your own.</div></div>}
      <div className="list">
        {items.map((m) => (
          <div key={m.id} className="list-row">
            {editing === m.id ? (
              <input className="input grow" autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { void persist(items.map((x) => (x.id === m.id ? { ...x, text: editText } : x))); setEditing(null) } if (e.key === 'Escape') setEditing(null) }} />
            ) : (
              <div className="grow">
                <div>{m.text}</div>
                <div className="muted small">{m.tags.join(', ') || 'untagged'} · {m.source} · {new Date(m.createdAt).toLocaleDateString()}</div>
              </div>
            )}
            <button className="icon-btn" aria-label="Edit" onClick={() => { setEditing(m.id); setEditText(m.text) }}><Pencil size={14} /></button>
            <button className="icon-btn" aria-label={m.tags.includes('pinned') ? 'Unpin' : 'Pin'} title="Pinned entries are always sent" onClick={() => persist(items.map((x) => (x.id === m.id ? { ...x, tags: x.tags.includes('pinned') ? x.tags.filter((t) => t !== 'pinned') : [...x.tags, 'pinned'] } : x)))}>
              <span className={`pin ${m.tags.includes('pinned') ? 'on' : ''}`}>Pin</span>
            </button>
            <button className="icon-btn danger" aria-label="Delete" onClick={() => persist(items.filter((x) => x.id !== m.id))}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Storage
export function StorageView() {
  const [rep, setRep] = useState<StorageReport | null>(null)
  const notify = useStore.getState().notify
  const load = () => api.invoke<StorageReport>('storage:report').then(setRep).catch((e) => notify(e.message, 'error'))
  useEffect(() => {
    void load()
  }, [])
  const total = rep?.items.reduce((a, b) => a + b.bytes, 0) ?? 0
  return (
    <div className="view">
      <h1><HardDrive size={20} /> Storage</h1>
      <p className="muted small">Sizes are measured from the actual files on disk. Dahl Studio has no cloud backend or database; everything below is on this computer. Cleanup never touches your project source files.</p>
      {rep && (
        <>
          <div className="row"><span>Application data: <code>{rep.appDataDir}</code></span><button className="btn small ghost" onClick={() => api.invoke('storage:open', rep.appDataDir)}><FolderOpen size={13} /> Open</button></div>
          <div className="list">
            {rep.items.map((i) => (
              <div key={i.path} className="list-row">
                <div className="grow"><div>{i.label}</div><div className="muted small ellipsis">{i.path}</div></div>
                <span className="mono">{fmtBytes(i.bytes)}</span>
                <button className="icon-btn" aria-label="Open location" onClick={() => api.invoke('storage:open', i.path).catch((e) => notify(e.message, 'error'))}><FolderOpen size={14} /></button>
              </div>
            ))}
          </div>
          <div className="row"><b>Total</b><span className="mono">{fmtBytes(total)}</span></div>
          <div className="row">
            <button className="btn ghost" onClick={async () => { if (window.confirm('Delete Dahl Studio log files?')) { await api.invoke('storage:clearLogs'); void load() } }}>Clear logs</button>
            <button className="btn ghost" onClick={async () => { if (window.confirm('Reset locally measured usage counters?')) { await api.invoke('usage:reset'); useStore.getState().set({ usage: await api.invoke('usage:get') }); void load() } }}>Reset usage counters</button>
            <button className="btn ghost" onClick={load}><RefreshCw size={13} /> Refresh</button>
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Welcome
export function Welcome({ onOpen }: { onOpen: () => void }) {
  const keys = useStore((s) => s.keys)
  const set = useStore((s) => s.set)
  return (
    <div className="welcome">
      <img src={wordmarkUrl} alt="Dahl Studio" className="wordmark" />
      <p className="muted">A local-first coding studio powered by Dahl. Your files, memory and task history stay on this computer.</p>
      <div className="row center">
        <button className="btn primary" onClick={onOpen}><FolderOpen size={15} /> Open project folder</button>
        {!keys.some((k) => k.configured) && <button className="btn ghost" onClick={() => set({ view: 'settings' })}><KeyRound size={15} /> Add Dahl API key</button>}
      </div>
      <div className="welcome-checks small">
        <div>{keys.some((k) => k.configured) ? <CheckCircle2 size={14} className="c-ok" /> : <XCircle size={14} className="c-muted" />} Dahl API key</div>
      </div>
    </div>
  )
}
