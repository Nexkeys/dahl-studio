import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react'
import type { PrereqStatus } from '@shared/types'
import { FixCommand } from './FixCommand'
import '../ui-setup.css'

/** A catalogue connector's own requirements on its card: met, or what is missing and how to fix it. */
export function PrereqNote({ status, busy, onRecheck }: { status: PrereqStatus; busy: boolean; onRecheck: () => void }) {
  return (
    <div className={`prereq ${status.ok ? 'ok' : 'bad'}`} role="status">
      <div className="prereq-head">
        {status.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
        <b className="grow">{status.ok ? 'Requirements met: ' : ''}{status.summary}</b>
        <button className="btn small ghost" disabled={busy} onClick={onRecheck} title="Check again">{busy ? <span className="spinner" /> : <RefreshCw size={12} />} Check again</button>
      </div>
      {status.detail && <div className="muted">{status.detail}</div>}
      {status.fixes.map((f, i) => <FixCommand key={i} fix={f} onDone={onRecheck} />)}
    </div>
  )
}
