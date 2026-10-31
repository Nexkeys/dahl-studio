import { Suspense, useEffect, useState } from 'react'
import { GitBranch, GitCommit, RefreshCw, Upload, Link2, Sparkles, KeyRound } from 'lucide-react'
import { api, useStore } from '../store'
import { languageFor } from '../lang'
import { DiffEditor } from '../lazyMonaco'

interface Status { repo: boolean; branch: string | null; ahead: number; behind: number; files: { path: string; index: string; work: string }[]; remote: string | null; hasCommits: boolean; upstream: string | null; unpushed: number }
interface Plan { remote: string | null; branch: string | null; target: string; commits: number; hasCommits: boolean }

/** Publish box: paste a GitHub link, set it as origin, push. Optional GitHub token (stored encrypted in the main process). */
function Publish({ root, st, busy, act }: { root: string; st: Status | null; busy: string | null; act: (label: string, fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [showToken, setShowToken] = useState(false)
  useEffect(() => void api.invoke<boolean>('git:tokenStatus').then(setHasToken).catch(() => {}), [])
  useEffect(() => setUrl(st?.remote ?? ''), [st?.remote])
  const push = async () => {
    const p = await api.invoke<Plan>('git:plan', root)
    if (!window.confirm(`Push ${p.commits} commit(s) on "${p.branch}" to ${p.remote}?\n\nThis publishes your commits. Dahl Studio never force-pushes.`)) return
    await act('push', () => api.invoke('git:push', root), 'Pushed')
  }
  const sync = !st?.repo ? '' : !st.hasCommits ? 'No commits yet: commit your files first.' : !st.remote ? 'No remote yet: paste your repository link.'
    : st.upstream ? `${st.ahead} to push${st.behind ? `, ${st.behind} behind (pull first)` : ''} vs ${st.upstream}` : `${st.unpushed} commit(s) not on the remote yet`
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card-head small"><Upload size={13} /> <b>Publish to GitHub</b></div>
      <div className="row" style={{ margin: '6px 0' }}>
        <input className="input small" style={{ flex: 1, maxWidth: 'none' }} placeholder="github.com/you/repo" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Remote repository link" />
        <button className="btn ghost small" disabled={!url.trim() || url.trim() === st?.remote || !!busy} onClick={() => act('remote', () => api.invoke('git:remote', root, url), 'Remote set')}>
          {busy === 'remote' ? <span className="spinner" /> : <Link2 size={13} />} Set remote
        </button>
      </div>
      {sync && <div className="muted small">{sync}</div>}
      <div className="row" style={{ margin: '6px 0 0' }}>
        <button className="btn primary small" disabled={!st?.remote || !st?.hasCommits || !!busy} onClick={() => void push()}>{busy === 'push' ? <span className="spinner" /> : <Upload size={13} />} Push</button>
        <button className="btn ghost small" onClick={() => setShowToken(!showToken)}><KeyRound size={13} /> Token{hasToken ? ' (saved)' : ''}</button>
      </div>
      {showToken && (
        <div className="small" style={{ marginTop: 6 }}>
          <div className="muted">Optional GitHub personal access token (fine-grained, Contents: read and write). Stored encrypted on this PC, never sent to the AI. Without one, Git Credential Manager signs you in.</div>
          <div className="row" style={{ margin: '6px 0 0' }}>
            <input className="input small" type="password" style={{ flex: 1, maxWidth: 'none' }} placeholder={hasToken ? 'Token saved (enter a new one to replace)' : 'github_pat_...'} value={token} onChange={(e) => setToken(e.target.value)} aria-label="GitHub token" />
            <button className="btn ghost small" disabled={!token.trim()} onClick={() => act('token', () => api.invoke<boolean>('git:setToken', token).then((h) => (setHasToken(h), setToken(''), 'Token saved')), 'Token saved')}>Save</button>
          </div>
          <div className="row" style={{ margin: '6px 0 0' }}>
            <button className="btn ghost small" disabled={!!busy} onClick={() => act('test', () => api.invoke<string>('git:testToken', root), 'OK')}>{busy === 'test' ? <span className="spinner" /> : null} Test</button>
            {hasToken && <button className="btn ghost small" onClick={() => act('token', () => api.invoke<boolean>('git:setToken', null).then((h) => (setHasToken(h), 'Token removed')), 'Token removed')}>Remove</button>}
          </div>
        </div>
      )}
    </div>
  )
}

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
      // first line as the toast; multi-line results (notes, test details) are shown in full
      notify(typeof r === 'string' && r ? r.split('\n').filter((l) => !/^(To |\s|branch '.*' set up)/.test(l)).join('\n') : ok)
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
        <div className="card">
          <div>This folder is not a Git repository. Initialise it, commit your files, then paste your GitHub link to publish.</div>
          <div className="row"><button className="btn primary" disabled={!!busy} onClick={() => act('init', () => api.invoke('git:remote', root), 'Initialised')}>Initialise repository</button></div>
        </div>
      )}
      {st?.repo && (
        <div className="git-layout">
          <div className="git-side">
            <div className="row small"><GitBranch size={13} /> <b>{st.branch ?? 'detached'}</b>{st.upstream ? `${st.ahead ? ` · ${st.ahead} to push` : ''}${st.behind ? ` · ${st.behind} behind` : ''}` : st.unpushed ? ` · ${st.unpushed} not pushed` : ''}</div>
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
              <NewBranch disabled={!!busy} onCreate={(n) => void act('branch', () => api.invoke('git:branch', root, n), 'Branch created')} />
            </div>
            <Publish root={root} st={st} busy={busy} act={act} />
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

/** Branch name typed inline (window.prompt() does not exist in Electron, so the old button did nothing). */
function NewBranch({ disabled, onCreate }: { disabled: boolean; onCreate: (name: string) => void }) {
  const [name, setName] = useState<string | null>(null)
  if (name === null) return <button className="btn ghost small" disabled={disabled} onClick={() => setName('')}><GitBranch size={13} /> Branch</button>
  const ok = /^[w./-]+$/.test(name)
  const done = () => { if (ok) { onCreate(name); setName(null) } }
  return (
    <span className="reject-box">
      <input autoFocus value={name} placeholder="new-branch-name" aria-label="New branch name" aria-invalid={!!name && !ok}
        onChange={(e) => setName(e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') setName(null) }} />
      <button className="btn ghost small" disabled={!ok || disabled} onClick={done}>Create</button>
    </span>
  )
}
