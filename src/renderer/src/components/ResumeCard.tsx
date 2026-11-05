import { useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { baseName, useStore } from '../store'
import { resumeRuns } from '../resume'

/** After a quit or crash during a task: offer to continue it where it stopped. */
export function ResumeCard() {
  const offer = useStore((s) => s.resumeOffer)
  const set = useStore((s) => s.set)
  const [busy, setBusy] = useState(false)
  if (!offer) return null
  const n = offer.runs.length
  const resume = async () => {
    setBusy(true)
    await resumeRuns(offer)
    set({ resumeOffer: null, view: 'workspace' })
  }
  return (
    <div className="resume-card reveal" role="alertdialog" aria-labelledby="resume-title">
      <div className="resume-head">
        <RotateCcw size={15} />
        <b id="resume-title">{n === 1 ? 'A task was interrupted' : `${n} tasks were interrupted`}</b>
        <button className="icon-btn" aria-label="Dismiss" onClick={() => set({ resumeOffer: null })}><X size={14} /></button>
      </div>
      <p className="muted small">{offer.reason === 'crash' ? 'Dahl Studio closed unexpectedly' : 'Dahl Studio was closed'} while {n === 1 ? 'it was' : 'they were'} running. {n === 1 ? 'Its' : 'Their'} progress is saved.</p>
      <ul className="resume-list">
        {offer.runs.slice(0, 3).map((r) => <li key={r.runId}><span className="ellipsis">{r.objective}</span><span className="muted small">{baseName(r.project)}</span></li>)}
        {n > 3 && <li className="muted small">and {n - 3} more</li>}
      </ul>
      <div className="row-actions end">
        <button className="btn small ghost" disabled={busy} onClick={() => set({ resumeOffer: null })}>Not now</button>
        <button className="btn small primary" disabled={busy} onClick={resume}><RotateCcw size={13} /> {n === 1 ? 'Continue it' : 'Continue them'}</button>
      </div>
    </div>
  )
}
