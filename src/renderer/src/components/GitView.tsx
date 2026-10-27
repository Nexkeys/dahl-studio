import { Suspense, useEffect, useState } from 'react'
import { GitBranch, GitCommit, RefreshCw, Upload, Link2, Sparkles } from 'lucide-react'
import { api, useStore } from '../store'
import { languageFor } from '../lang'
import { DiffEditor } from '../lazyMonaco'

interface Status { repo: boolean; branch: string | null; ahead: number; behind: number; files: { path: string; index: string; work: string }[]; remote: string | null }

export function GitView() {
  const root = useStore((s) => s.settings?.activeProject ?? null)
  const theme = useStore((s) => s.settings?.theme ?? 'dahl-classic')
  const [st, setSt] = useState<Status | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ before: string; after: string } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const { notify, set } = useStore.getState()
  const load = () => root && api.invoke<Status>('git:status', root).then(setSt).catch((e) => notify(e.message, 'error'))
  useEffect(() => void load(), [root])
  useEffect(() => {
    if (!root || !sel) return setDiff(null)
    void Promise.all([api.invoke<string>('git:head', root, sel), api.invoke<string>('fs:read', root, sel).catch(() => '')]).then(([before, after]) => setDiff({ before, after }))
  }, [root, sel])
  if (!root) return <div className="view"><h1>Source Control</h1><div className="muted">Open a project first.</div></div>

  const act = async (label: string, fn: () => Promise<string | unknown>, ok: string) => {
    setBusy(label)
    try {
      const r = await fn()
      notify(typeof r === 'string' && r ? r.split('\n')[0] : ok)
      void load()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="view wide git-view">
      <h1><GitBranch size={20} /> Source Control <button className="icon-btn" aria-label="Refresh" onClick={load}><RefreshCw size={15} /></button></h1>
      {st && !st.repo && (
        <div className="card"><div>This folder is not a Git repository.</div><div className="row"><button className="btn primary" onClick={() => act('init', () => api.invoke('git:remote', root), 'Initialised')}>Initialise repository</button></div></div>
      )}
      {st?.repo && (
        <div className="git-layout">
          <div className="git-side">
            <div className="row small"><GitBranch size={13} /> <b>{st.branch ?? 'detached'}</b>{st.ahead ? ` · ${st.ahead} to push` : ''}{st.behind ? ` · ${st.behind} behind` : ''}</div>
            <div className="muted small ellipsis">{st.remote ?? 'No remote'}</div>
            <div className="git-files">
              {!st.files.length && <div className="muted small pad">No changes</div>}
              {st.files.map((f) => (
                <button key={f.path} className={`git-file ${sel === f.path ? 'on' : ''}`} onClick={() => setSel(f.path)}>
                  <span className={`git-badge s-${(f.index + f.work).trim()[0] ?? 'M'}`}>{(f.index + f.work).trim() || 'M'}</span><span className="ellipsis">{f.path}</span>
                </button>
              ))}
            </div>
            <textarea className="input area" placeholder="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <div className="row wrap">
              <button className="btn primary small" disabled={!msg.trim() || !st.files.length || !!busy} onClick={() => window.confirm(`Commit all ${st.files.length} changed files?\n\n${msg}`) && act('commit', () => api.invoke('git:commit', root, msg, 'all').then((r) => (setMsg(''), r)), 'Committed')}><GitCommit size={13} /> Commit all</button>
              <button className="btn ghost small" onClick={() => { set({ view: 'workspace', composerInsert: '/commit Look at the uncommitted changes (git diff) and draft a clear commit message.' }) }}><Sparkles size={13} /> Ask Dahl</button>
              <button className="btn ghost small" disabled={!!busy} onClick={() => { const n = window.prompt('New branch name'); if (n) void act('branch', () => api.invoke('git:branch', root, n), 'Branch created') }}><GitBranch size={13} /> Branch</button>
              <button className="btn ghost small" disabled={!!busy} onClick={() => { const u = window.prompt('Remote repository URL (https://github.com/you/repo.git)', st.remote ?? ''); if (u) void act('remote', () => api.invoke('git:remote', root, u), 'Remote set') }}><Link2 size={13} /> Remote</button>
              <button className="btn ghost small" disabled={!st.remote || !!busy} onClick={() => window.confirm(`Push branch "${st.branch}" to ${st.remote}?\n\nThis publishes your commits. Dahl Studio never force-pushes.`) && act('push', () => api.invoke('git:push', root), 'Pushed')}>{busy === 'push' ? <span className="spinner" /> : <Upload size={13} />} Push</button>
            </div>
          </div>
          <div className="git-diff">
            {diff && sel ? (
              <Suspense fallback={<div className="empty-state"><span className="spinner" /></div>}>
                <DiffEditor keepCurrentOriginalModel keepCurrentModifiedModel original={diff.before} modified={diff.after} language={languageFor(sel)} theme={theme} options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 13, automaticLayout: true }} />
              </Suspense>
            ) : <div className="empty-state"><div className="muted">Select a changed file to see its diff against HEAD.</div></div>}
          </div>
        </div>
      )}
    </div>
  )
}
