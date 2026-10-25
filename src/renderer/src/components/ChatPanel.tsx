import { useEffect, useRef, useState } from 'react'
import { Square, Pause, Bookmark, Plus, CircleAlert, CircleCheck, Circle, CircleDot, Play, ScrollText } from 'lucide-react'
import type { RunState } from '@shared/types'
import { api, useStore } from '../store'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { Markdown } from './Markdown'
import iconUrl from '../assets/icon.png'

const SUGGESTIONS = [
  'Explain how this project is structured',
  'Review this project for bugs and security issues in parallel',
  'Build a polished landing page with Tailwind',
  'Write tests for the main module and run them'
]

function Elapsed({ since }: { since: number | null }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!since) return
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [since])
  if (!since) return null
  return <span className="muted small">{Math.round((Date.now() - since) / 1000)}s</span>
}

export function ChatPanel({ root }: { root: string }) {
  const p = useStore((s) => s.projects[root])
  const mode = useStore((s) => s.mode)
  const web = useStore((s) => s.web)
  const settings = useStore((s) => s.settings)
  const keys = useStore((s) => s.keys)
  const { patchProject, notify, set } = useStore.getState()
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const running = p?.status === 'running' || p?.status === 'waiting_approval'

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [p?.transcript.length, p?.live, p?.liveReasoning])

  const send = async (text: string) => {
    if (running) return
    if (!settings?.defaultModel) return notify('Select a model first.', 'error')
    const provider = settings.defaultModel.split(':')[0]
    const hasKey = provider === 'dahl' ? keys.some((k) => k.provider === 'dahl' && k.configured) : keys.some((k) => k.provider === provider && k.configured)
    if (!hasKey) return notify(`Add a ${provider} API key in Settings first.`, 'error')
    const attachments = p?.attachments ?? []
    patchProject(root, { attachments: [], turnStartedAt: Date.now() })
    stick.current = true
    try {
      const resumable = p?.runId && p.status && p.status !== 'running'
      await api.invoke('agent:start', { project: root, prompt: text, mode, web, attachments, thinking: settings.thinking, model: settings.defaultModel, resumeRunId: resumable ? p!.runId : undefined })
    } catch (e) {
      notify((e as Error).message, 'error')
      patchProject(root, { attachments })
    }
  }

  const transcript = p?.transcript ?? []
  const canContinue = p?.runId && (p.status === 'paused' || p.status === 'interrupted' || p.status === 'failed')

  return (
    <div className="panel chat">
      <div className="panel-head">
        <span className="panel-title">Dahl</span>
        <span className={`run-badge ${p?.status ?? 'idle'}`}>{statusLabel(p?.status ?? null)}</span>
        {running && <Elapsed since={p?.turnStartedAt ?? null} />}
        <div className="row-actions">
          {p?.runId && <button className="icon-btn" title="Task log" aria-label="Task log" onClick={() => set({ view: 'logs' })}><ScrollText size={15} /></button>}
          {running && <button className="icon-btn" title="Save checkpoint" aria-label="Save checkpoint" onClick={() => api.invoke('agent:checkpoint', root)}><Bookmark size={15} /></button>}
          {running && <button className="icon-btn" title="Pause after current step" aria-label="Pause" onClick={() => api.invoke('agent:pause', root)}><Pause size={15} /></button>}
          {running && <button className="icon-btn danger" title="Cancel task" aria-label="Cancel" onClick={() => api.invoke('agent:cancel', root)}><Square size={14} /></button>}
          <button className="icon-btn" title="New conversation" aria-label="New conversation" disabled={running} onClick={() => patchProject(root, { runId: null, status: null, transcript: [], plan: [], live: '', liveReasoning: '', agents: {} })}><Plus size={16} /></button>
        </div>
      </div>

      {p?.plan.length ? (
        <div className="plan">
          {p.plan.map((s, i) => (
            <div key={i} className={`plan-step ${s.status}`}>
              {s.status === 'done' ? <CircleCheck size={13} /> : s.status === 'in_progress' ? <CircleDot size={13} /> : s.status === 'failed' ? <CircleAlert size={13} /> : <Circle size={13} />}
              <span>{s.title}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="transcript" ref={scroller} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
        {!transcript.length && !p?.live && (
          <div className="chat-empty reveal">
            <img src={iconUrl} alt="Dahl Studio" className="chat-empty-logo" />
            <div className="empty-title">Build. Debug. Ship.</div>
            <div className="muted small">File edits and commands wait for your approval. Attach files, folders or images, toggle web research, or pick a skill.</div>
            <div className="suggestions">{SUGGESTIONS.map((s) => <button key={s} className="suggestion" onClick={() => set({ composerInsert: s })}>{s}</button>)}</div>
          </div>
        )}
        <Transcript root={root} items={transcript} running={!!running} />
        {p?.liveReasoning && !p.live && <div className="thinking-live"><span className="shimmer">Thinking</span><div className="thinking-tail">{p.liveReasoning.slice(-280)}</div></div>}
        {p?.live && (
          <div className="msg assistant">
            <div className="msg-who"><img src={iconUrl} alt="" className="avatar" /> Dahl</div>
            <Markdown text={p.live} /><span className="caret" />
          </div>
        )}
        {p?.status === 'running' && !p.live && !p.liveReasoning && <div className="status-line working"><span className="shimmer">Working</span></div>}
        {canContinue && (
          <div className="continue-bar reveal">
            <span className="small">This task is {p!.status}. Its state is saved locally.</span>
            <button className="btn small primary" onClick={() => send('Continue')}><Play size={13} /> Continue</button>
          </div>
        )}
      </div>
      <Composer root={root} running={!!running} onSend={send} />
    </div>
  )
}

function statusLabel(s: string | null): string {
  return ({ running: 'Working', waiting_approval: 'Waiting for approval', paused: 'Paused', completed: 'Done', cancelled: 'Cancelled', failed: 'Failed', interrupted: 'Interrupted' } as Record<string, string>)[s ?? ''] ?? 'Idle'
}

export async function loadRunIntoChat(root: string, id: string): Promise<void> {
  const run = await api.invoke<RunState | null>('agent:loadRun', root, id)
  if (!run) return
  useStore.getState().patchProject(root, { runId: run.id, status: run.status, transcript: run.transcript, plan: run.plan, live: '', liveReasoning: '', agents: Object.fromEntries((run.agents ?? []).map((a) => [a.id, a])) })
}
