import { Circle, CircleCheck, CirclePause, CircleX, Hand, LoaderCircle, MessageCircleQuestionMark } from 'lucide-react'
import { STATUS_LABEL, type StatusKind } from '../status'

// Each state has its own shape, so it reads without colour: a raised hand or a question bubble (needs you), an open
// spinning arc (working), a solid disc with a cross (failed), a solid dot (done, not seen), a pause circle, a check.
const ICON = { needs: Hand, running: LoaderCircle, failed: CircleX, paused: CirclePause, done: CircleCheck, idle: Circle }

export function StatusIcon({ kind, question, size = 14, label, hideIdle }: { kind: StatusKind; question?: boolean; size?: number; label?: string; hideIdle?: boolean }) {
  if (kind === 'idle' && hideIdle) return null
  const text = label ?? (kind === 'needs' && question ? 'Needs your answer' : STATUS_LABEL[kind])
  if (kind === 'unread')
    return <span className="st st-unread" role="img" aria-label={text} title={text} style={{ width: size, height: size }}><i /></span>
  const Icon = kind === 'needs' && question ? MessageCircleQuestionMark : ICON[kind]
  return <span className={`st st-${kind}`} role="img" aria-label={text} title={text}><Icon size={size} aria-hidden /></span>
}

/** Icon plus words, for the chat header and lists. */
export function StatusBadge({ kind, text, question }: { kind: StatusKind; text: string; question?: boolean }) {
  return (
    <span className={`st-badge st-badge-${kind}`}>
      <StatusIcon kind={kind} question={question} size={12} label={text} />
      <span>{text}</span>
    </span>
  )
}
