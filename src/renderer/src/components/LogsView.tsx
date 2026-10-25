import { useEffect, useState } from 'react'
import { ScrollText, RefreshCw, Copy } from 'lucide-react'
import type { RunState, RunSummary } from '@shared/types'
import { api, baseName, loadRunsSummary, useStore } from '../store'

type Entry = { at: string; level: string; text?: string; msg?: string }

/** Error and event logs per task (stored in <project>/.dahl/runs/<id>.json) plus the application log. */
export function LogsView() {
  const settings = useStore((s) => s.settings)
  const activeRun = useStore((s) => (settings?.activeProject ? s.projects[settings.activeProject]?.runId : null))
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [sel, setSel] = useState<string>('app')
  const [entries, setEntries] = useState<Entry[]>([])
  const [onlyErrors, setOnlyErrors] = useState(false)

  const loadRuns = async () => {
    const all = await Promise.all((settings?.openProjects ?? []).map((p) => loadRunsSummary(p).catch(() => [])))
    setRuns(all.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  }
  useEffect(() => {
    void loadRuns()
    if (activeRun) setSel(activeRun)
  }, [settings])
  const load = async () => {
    if (sel === 'app') return setEntries((await api.invoke<Entry[]>('logs:app')).reverse())
    const r = runs.find((x) => x.id === sel)
    if (!r) return setEntries([])
    const run = await api.invoke<RunState | null>('agent:loadRun', r.project, r.id)
    setEntries([...(run?.log ?? [])].reverse())
  }
  useEffect(() => void load(), [sel, runs])
  const shown = entries.filter((e) => !onlyErrors || e.level === 'error')

  return (
    <div className="view wide">
      <h1><ScrollText size={20} /> Logs</h1>
      <div className="row">
        <select className="input grow" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Log source">
          <option value="app">Application log</option>
          {runs.map((r) => <option key={r.id} value={r.id}>{baseName(r.project)} · {r.status} · {r.objective.slice(0, 70)}</option>)}
        </select>
        <label className="check small"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Errors only</label>
        <button className="btn ghost small" onClick={() => void loadRuns().then(load)}><RefreshCw size={13} /> Refresh</button>
        <button className="btn ghost small" onClick={() => navigator.clipboard.writeText(shown.map((e) => `${e.at} ${e.level.toUpperCase()} ${e.text ?? e.msg}`).join('\n'))}><Copy size={13} /> Copy</button>
      </div>
      <p className="muted small">Secrets are redacted before anything is logged. Task logs record API errors (with status and kind), tool failures, approvals and turn summaries.</p>
      <div className="log-list">
        {!shown.length && <div className="muted small pad">No entries.</div>}
        {shown.map((e, i) => (
          <div key={i} className={`log-row ${e.level}`}>
            <span className="mono muted">{e.at ? new Date(e.at).toLocaleTimeString() : ''}</span>
            <span className={`pill ${e.level === 'error' ? 'error' : ''}`}>{e.level}</span>
            <pre className="log-text">{e.text ?? e.msg}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}
