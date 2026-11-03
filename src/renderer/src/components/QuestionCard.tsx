import { useState } from 'react'
import { MessageCircleQuestion, Send } from 'lucide-react'
import type { PendingApproval } from '@shared/types'
import { api, useStore } from '../store'

/** The agent's ask_user questions: pick an option (or several), or type your own answer, then send them together. */
export function QuestionCard({ root, approval }: { root: string; approval: PendingApproval }) {
  const qs = approval.questions ?? []
  const [picked, setPicked] = useState<Record<number, number[]>>({})
  const [other, setOther] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const patch = useStore((s) => s.patchProject)

  const answerOf = (i: number): string => {
    const labels = (picked[i] ?? []).map((j) => qs[i].options[j]?.label).filter(Boolean)
    const own = other[i]?.trim()
    return [...labels, ...(own ? [own] : [])].join(', ')
  }
  const ready = qs.every((_, i) => answerOf(i))

  const choose = (i: number, j: number) => {
    setPicked((p) => {
      const cur = p[i] ?? []
      if (!qs[i].multiSelect) return { ...p, [i]: [j] }
      return { ...p, [i]: cur.includes(j) ? cur.filter((x) => x !== j) : [...cur, j] }
    })
    if (!qs[i].multiSelect) setOther((o) => ({ ...o, [i]: '' }))
  }
  const typeOwn = (i: number, v: string) => {
    setOther((o) => ({ ...o, [i]: v }))
    if (!qs[i].multiSelect && v) setPicked((p) => ({ ...p, [i]: [] }))
  }
  const finish = async (ok: boolean) => {
    setBusy(true)
    const answers = Object.fromEntries(qs.map((_, i) => [String(i), answerOf(i)]))
    try {
      await api.invoke('agent:approve', approval.id, ok, ok ? JSON.stringify(answers) : undefined)
      patch(root, (c) => ({ approvals: c.approvals.filter((a) => a.id !== approval.id) }))
    } catch (e) {
      setBusy(false)
      useStore.getState().notify((e as Error).message, 'error')
    }
  }

  return (
    <div className="question-card reveal" role="group" aria-label="Questions from Dahl">
      <div className="q-head"><MessageCircleQuestion size={15} /> {qs.length > 1 ? `Dahl has ${qs.length} questions` : 'Dahl has a question'}</div>
      {qs.map((q, i) => (
        <fieldset key={i} className="q-block">
          <legend>
            {q.header && <span className="q-chip">{q.header}</span>}
            <span className="q-text">{q.question}</span>
            {q.multiSelect && <span className="q-hint">Pick any</span>}
          </legend>
          <div className="q-options">
            {q.options.map((o, j) => {
              const on = (picked[i] ?? []).includes(j)
              return (
                <label key={j} className={`q-opt ${on ? 'on' : ''}`}>
                  <input type={q.multiSelect ? 'checkbox' : 'radio'} name={`${approval.id}-${i}`} checked={on} onChange={() => choose(i, j)} />
                  <span className="q-key" aria-hidden>{q.multiSelect ? (on ? '✓' : '') : j + 1}</span>
                  <span className="q-opt-text"><b>{o.label}</b>{o.description && <span>{o.description}</span>}</span>
                </label>
              )
            })}
            <input className="input q-other" value={other[i] ?? ''} placeholder="Or type your own answer" aria-label={`Your own answer to: ${q.question}`}
              onChange={(e) => typeOwn(i, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ready && !busy && void finish(true)} />
          </div>
        </fieldset>
      ))}
      <div className="row-actions end">
        <button className="btn small ghost" disabled={busy} onClick={() => finish(false)}>Skip</button>
        <button className="btn small primary" disabled={!ready || busy} onClick={() => finish(true)}><Send size={13} /> Send {qs.length > 1 ? 'answers' : 'answer'}</button>
      </div>
    </div>
  )
}
