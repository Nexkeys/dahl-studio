import { useEffect, useState } from 'react'
import { ChevronDown, Circle, CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import { useStore } from '../store'
import { isBusy } from '../chatState'
import { currentAction, formatElapsed, statusKind, statusText, turnStart, waitsForAnswer } from '../status'
import { StatusBadge, StatusIcon } from './StatusIcon'

const NO_APPROVALS: never[] = []

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

/** The chat header's status: shape, words and (while working) nothing else; the strip below carries the detail. */
export function ChatStatus({ root }: { root: string }) {
  const status = useStore((s) => s.projects[root]?.status ?? null)
  const unread = useStore((s) => {
    const p = s.projects[root]
    return !!p?.chats.find((t) => t.key === p.chat)?.unread
  })
  const approvals = useStore((s) => s.projects[root]?.approvals ?? NO_APPROVALS)
  const runId = useStore((s) => s.projects[root]?.runId ?? null)
  const transcript = useStore((s) => s.projects[root]?.transcript)
  const kind = statusKind(status, unread)
  return <StatusBadge kind={kind} text={statusText(status, unread)} question={kind === 'needs' && waitsForAnswer(approvals, runId, transcript ?? [])} />
}

/**
 * Pinned above the transcript while a task runs: what Dahl is doing now with the elapsed time, and the plan as a
 * compact step bar with the current step named. The full step list opens from it. After the task, the plan stays as
 * a one-line summary.
 */
export function ProgressStrip({ root }: { root: string }) {
  // narrow selectors: this re-renders on status and step changes, not on every streamed token
  const status = useStore((s) => s.projects[root]?.status ?? null)
  const plan = useStore((s) => s.projects[root]?.plan)
  const transcript = useStore((s) => s.projects[root]?.transcript)
  const approvals = useStore((s) => s.projects[root]?.approvals ?? NO_APPROVALS)
  const runId = useStore((s) => s.projects[root]?.runId ?? null)
  const live = useStore((s) => !!s.projects[root]?.live)
  const reasoning = useStore((s) => !!s.projects[root]?.liveReasoning)
  const startedAt = useStore((s) => s.projects[root]?.turnStartedAt ?? null)
  const [open, setOpen] = useState(false)
  const busy = isBusy(status)
  const now = useNow(busy)
  const steps = plan ?? []
  if (!busy && !steps.length) return null

  const items = transcript ?? []
  const kind = statusKind(status)
  const action = busy ? currentAction({ status, live: live ? '.' : '', liveReasoning: reasoning ? '.' : '', transcript: items, approvals, runId }) : null
  const start = turnStart(startedAt, items)
  const cur = steps.findIndex((s) => s.status === 'in_progress')
  const done = steps.filter((s) => s.status === 'done').length
  const failed = steps.some((s) => s.status === 'failed')
  const summary = cur >= 0 ? `Step ${cur + 1} of ${steps.length}: ${steps[cur].title}` : `${done} of ${steps.length} steps done${failed ? ', one failed' : ''}`

  return (
    <div className={`progress-strip ps-${kind}`}>
      {action && (
        <div className="ps-now" aria-live="polite">
          <StatusIcon kind={kind} question={action.text === 'Waiting for your answer'} size={14} />
          <span className="ps-action" title={action.text}>{action.text}</span>
          {action.last && action.text !== action.last && <span className="ps-last" title={`Last step: ${action.last}`}>{action.last}</span>}
          {start && <span className="ps-time" title="Time on this task">{formatElapsed(now - start)}</span>}
        </div>
      )}
      {steps.length > 0 && (
        <button className="ps-plan" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Hide the plan' : 'Show the whole plan'}>
          <span className="ps-segs" aria-hidden>{steps.map((s, i) => <i key={i} className={s.status} />)}</span>
          <span className="ps-step">{summary}</span>
          <ChevronDown size={13} className={`chev-d ${open ? 'open' : ''}`} />
        </button>
      )}
      {open && steps.length > 0 && (
        <ol className="ps-list">
          {steps.map((s, i) => (
            <li key={i} className={s.status}>
              {s.status === 'done' ? <CircleCheck size={13} /> : s.status === 'in_progress' ? <LoaderCircle size={13} className="ps-spin" /> : s.status === 'failed' ? <CircleX size={13} /> : <Circle size={13} />}
              <span>{s.title}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
