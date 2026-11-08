import { useMemo } from 'react'
import { Clock, CornerDownRight, Send, X } from 'lucide-react'
import { seenSteers, visibleOut, type OutMsg } from '@shared/outbox'
import type { TranscriptItem } from '@shared/types'
import { removeOut, useOutbox } from '../outbox'

/**
 * Chips above the composer for messages typed while Dahl works. "Next step" ones were handed to the task and vanish
 * when it reads them; "After this task" ones wait and go out together when the task finishes.
 */
export function Outbox({ runId, transcript, running, onSendNow }: { runId: string | null; transcript: TranscriptItem[]; running: boolean; onSendNow: (m: OutMsg) => void }) {
  const items = useOutbox((s) => s.items)
  const seen = useMemo(() => seenSteers(transcript), [transcript])
  const shown = useMemo(() => visibleOut(items, runId, seen), [items, runId, seen])
  if (!shown.length) return null
  return (
    <div className="outbox" aria-label="Messages waiting for Dahl">
      {shown.map((m) => (
        <div key={m.id} className={`out-chip ${m.kind}`}>
          {m.kind === 'steer' ? <CornerDownRight size={12} /> : <Clock size={12} />}
          <span className="out-when">{m.kind === 'steer' ? 'Next step' : running ? 'After this task' : 'Not sent'}</span>
          <span className="out-text" title={m.text}>{m.text}</span>
          {m.kind === 'queued' && (
            <>
              <button className="icon-btn tiny" title={running ? 'Tell Dahl now, at its next step' : 'Send now'} aria-label="Send now" onClick={() => onSendNow(m)}><Send size={11} /></button>
              <button className="icon-btn tiny" title="Remove" aria-label="Remove message" onClick={() => removeOut(m.id)}><X size={11} /></button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
