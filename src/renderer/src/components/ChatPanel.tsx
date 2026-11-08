import { useEffect, useRef, useState } from 'react'
import { Square, Pause, Bookmark, CircleAlert, CircleCheck, Circle, CircleDot, Play, ScrollText, Hammer } from 'lucide-react'
import type { RunSummary, StartRunRequest } from '@shared/types'
import { isLocalProvider } from '@shared/models'
import { api, useStore } from '../store'
import { attachRun, beginRun, openRunInChat, otherBusyChat, restoreChats } from '../chats'
import { ChatTabs } from './ChatTabs'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { Outbox } from './Outbox'
import { LiveMarkdown } from './Markdown'
import { useWhileWorking } from '../whileWorking'
import iconUrl from '../assets/icon.png'

const NO_ATTS: unknown[] = []

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

  useEffect(() => restoreChats(root), [root])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [p?.transcript.length, p?.live, p?.liveReasoning])

  const send = async (text: string, mcpServers?: StartRunRequest['mcpServers'], modeOverride?: StartRunRequest['mode']) => {
    if (running) return
    if (!settings?.defaultModel) return notify('Select a model first.', 'error')
    const provider = settings.defaultModel.split(':')[0]
    // Ollama and LM Studio run on this PC and need no key
    const hasKey = isLocalProvider(provider) || keys.some((k) => k.provider === provider && k.configured)
    if (!hasKey) return notify(`Add a ${provider} API key in Settings first.`, 'error')
    const busy = otherBusyChat(root)
    if (busy) return notify(`"${busy.title}" is still working in this project. Wait for it to finish or cancel it first.`, 'error')
    const attachments = p?.attachments ?? []
    patchProject(root, { attachments: [], turnStartedAt: Date.now() })
    stick.current = true
    const chat = beginRun(root, text)
    try {
      const resumable = p?.runId && p.status && p.status !== 'running'
      const run = await api.invoke<RunSummary>('agent:start', { project: root, prompt: text, mode: modeOverride ?? mode, web, attachments, thinking: settings.thinking, model: settings.defaultModel, resumeRunId: resumable ? p!.runId : undefined, mcpServers })
      attachRun(root, chat, run?.id ?? null)
    } catch (e) {
      attachRun(root, chat, null)
      notify((e as Error).message, 'error')
      patchProject(root, { attachments })
    }
  }

  const transcript = p?.transcript ?? []
  const { submit, sendNow } = useWhileWorking(root, { runId: p?.runId ?? null, status: p?.status ?? null, transcript, attachments: p?.attachments ?? NO_ATTS }, !!running, send)
  const canContinue = p?.runId && (p.status === 'paused' || p.status === 'interrupted' || p.status === 'failed')
  // a Plan or Review answer that says the work needs Build mode: one click switches and continues
  const lastAnswer = [...transcript].reverse().find((t) => t.kind === 'assistant')?.text ?? ''
  const offerBuild = !running && mode !== 'build' && p?.status === 'completed' && /Build mode|switch to Build/i.test(lastAnswer)

  return (
    <div className="panel chat">
      <div className="panel-head">
        <span className="panel-title">Dahl</span>
        {settings?.autoApproveAll && <span className="auto-badge" title={settings.askBeforePublishing ? 'Never ask is on: Dahl does not stop for approvals (publishing to GitHub still asks). Change it in Settings > Approvals.' : 'Never ask is on: Dahl does not stop for any approval. Change it in Settings > Approvals.'}>Auto-approve on</span>}
        <span className={`run-badge ${p?.status ?? 'idle'}`}>{statusLabel(p?.status ?? null)}</span>
        {running && <Elapsed since={p?.turnStartedAt ?? null} />}
        <div className="row-actions">
          {p?.runId && <button className="icon-btn" title="Task log" aria-label="Task log" onClick={() => set({ view: 'logs' })}><ScrollText size={15} /></button>}
          {running && <button className="icon-btn" title="Save checkpoint" aria-label="Save checkpoint" onClick={() => api.invoke('agent:checkpoint', root)}><Bookmark size={15} /></button>}
          {running && <button className="icon-btn" title="Pause after current step" aria-label="Pause" onClick={() => api.invoke('agent:pause', root)}><Pause size={15} /></button>}
          {running && <button className="icon-btn danger" title="Cancel task" aria-label="Cancel" onClick={() => api.invoke('agent:cancel', root)}><Square size={14} /></button>}
        </div>
      </div>
      <ChatTabs root={root} />

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
            <LiveMarkdown text={p.live} /><span className="caret" />
          </div>
        )}
        {p?.status === 'running' && !p.live && !p.liveReasoning && <div className="status-line working"><span className="shimmer">Working</span></div>}
        {offerBuild && (
          <div className="continue-bar reveal">
            <span className="small">Dahl needs Build mode to make these changes or run commands.</span>
            <button className="btn small primary" onClick={() => (set({ mode: 'build' }), void send('Switched to Build mode. Go ahead and do it.', undefined, 'build'))}><Hammer size={13} /> Switch to Build and continue</button>
          </div>
        )}
        {canContinue && (
          <div className="continue-bar reveal">
            <span className="small">{p!.status === 'failed' ? 'This task stopped with an error.' : p!.status === 'paused' ? 'This task is paused.' : 'This task was interrupted.'} Its progress is saved, so it can pick up from here.</span>
            <button className="btn small primary" onClick={() => send('Continue')}><Play size={13} /> Continue</button>
          </div>
        )}
      </div>
      <Outbox runId={p?.runId ?? null} transcript={transcript} running={!!running} onSendNow={(m) => void sendNow(m)} />
      <Composer root={root} running={!!running} onSend={(t, m, how) => void submit(t, m, how)} />
    </div>
  )
}

function statusLabel(s: string | null): string {
  return ({ running: 'Working', waiting_approval: 'Waiting for approval', paused: 'Paused', completed: 'Done', cancelled: 'Cancelled', failed: 'Failed', interrupted: 'Interrupted' } as Record<string, string>)[s ?? ''] ?? 'Idle'
}

/** Open a saved run (from Tasks) in its own chat tab. */
export const loadRunIntoChat = (root: string, id: string): Promise<void> => openRunInChat(root, id)
