import { useState, type ReactElement } from 'react'
import { ChevronRight, Wrench, Terminal, FileDiff, CircleAlert, CircleCheck, Brain, Globe, Image as ImageIcon, Users, Copy, Undo2, Files, Clock, BookmarkPlus, Paperclip } from 'lucide-react'
import type { TranscriptItem } from '@shared/types'
import { api, useStore } from '../store'
import { Markdown } from './Markdown'
import { ApprovalCard } from './ApprovalCard'
import { AgentChips } from './AgentsView'
import iconUrl from '../assets/icon.png'

function toolIcon(name: string) {
  if (name === 'run_command') return <Terminal size={13} />
  if (/write|edit|append/.test(name)) return <FileDiff size={13} />
  if (/web_/.test(name)) return <Globe size={13} />
  if (/image/.test(name)) return <ImageIcon size={13} />
  if (name === 'delegate_agents') return <Users size={13} />
  return <Wrench size={13} />
}

function Step({ item }: { item: TranscriptItem }) {
  const [open, setOpen] = useState(false)
  if (item.kind === 'reasoning')
    return (
      <div className="step">
        <button className="step-head" onClick={() => setOpen(!open)} aria-expanded={open}><ChevronRight size={12} className={`chev ${open ? 'open' : ''}`} /><Brain size={13} /><span className="step-text">Reasoning</span></button>
        {open && <pre className="step-body">{item.text}</pre>}
      </div>
    )
  if (item.kind === 'tool' && item.tool)
    return (
      <div className={`step ${item.tool.ok === false ? 'failed' : ''}`}>
        <button className="step-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronRight size={12} className={`chev ${open ? 'open' : ''}`} />{toolIcon(item.tool.name)}<span className="step-text">{item.text}</span>
          {item.tool.ok === false ? <CircleAlert size={12} className="c-danger" /> : <CircleCheck size={12} className="c-ok" />}
        </button>
        {open && <pre className="step-body">{item.tool.result}</pre>}
      </div>
    )
  return <div className="step note">{item.text}</div>
}

function Activity({ items, live }: { items: TranscriptItem[]; live: boolean }) {
  const [open, setOpen] = useState(false)
  const tools = items.filter((i) => i.kind === 'tool')
  const failed = tools.filter((t) => t.tool?.ok === false).length
  const last = [...items].reverse().find((i) => i.kind === 'tool')
  return (
    <div className={`activity ${live ? 'live' : ''}`}>
      <button className="activity-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={13} className={`chev ${open ? 'open' : ''}`} />
        {live ? <span className="spinner" /> : <Wrench size={13} />}
        <span>{live ? (last ? last.text : 'Thinking') : tools.length ? `Worked through ${tools.length} step${tools.length === 1 ? '' : 's'}` : 'Reasoning'}</span>
        {failed > 0 && <span className="pill warn">{failed} failed</span>}
      </button>
      {open && <div className="activity-body">{items.map((i) => <Step key={i.id} item={i} />)}</div>}
    </div>
  )
}

function Summary({ root, item }: { root: string; item: TranscriptItem }) {
  const s = item.summary!
  const runId = useStore((st) => st.projects[root]?.runId)
  const [open, setOpen] = useState(false)
  const [reverted, setReverted] = useState(!s.revertable)
  const failed = s.commands.filter((c) => c.exitCode !== 0).length
  const revert = async () => {
    if (!runId || !window.confirm(`Restore ${s.changedFiles.length} file(s) to their state before this turn?`)) return
    try {
      const files = await api.invoke<string[]>('agent:revert', root, runId)
      setReverted(true)
      useStore.getState().notify(`Reverted ${files.length} file(s)`)
      useStore.getState().patchProject(root, (c) => ({ treeVersion: c.treeVersion + 1 }))
    } catch (e) {
      useStore.getState().notify((e as Error).message, 'error')
    }
  }
  return (
    <div className="summary-card">
      <button className="summary-chips" onClick={() => setOpen(!open)} aria-expanded={open}>
        {s.changedFiles.length > 0 && <span className="chip"><Files size={12} /> {s.changedFiles.length} file{s.changedFiles.length > 1 ? 's' : ''} changed</span>}
        {s.commands.length > 0 && <span className={`chip ${failed ? 'warn' : ''}`}><Terminal size={12} /> {s.commands.length} command{s.commands.length > 1 ? 's' : ''}{failed ? `, ${failed} failed` : ''}</span>}
        {s.memoriesSaved > 0 && <span className="chip"><BookmarkPlus size={12} /> {s.memoriesSaved} saved to memory</span>}
        <span className="chip muted"><Clock size={12} /> {Math.max(1, Math.round(s.durationMs / 1000))}s</span>
      </button>
      {s.changedFiles.length > 0 && !reverted && <button className="btn tiny ghost" onClick={revert} title="Undo this turn's file changes"><Undo2 size={12} /> Revert</button>}
      {open && (
        <div className="summary-body">
          {s.changedFiles.map((f) => <div key={f} className="mono small">{f}</div>)}
          {s.commands.map((c, i) => <div key={i} className={`mono small ${c.exitCode !== 0 ? 'c-danger' : ''}`}>exit {c.exitCode ?? 'n/a'}  {c.command}</div>)}
        </div>
      )}
    </div>
  )
}

export function Transcript({ root, items, running }: { root: string; items: TranscriptItem[]; running: boolean }) {
  const out: ReactElement[] = []
  let group: TranscriptItem[] = []
  const flush = (live: boolean) => {
    if (!group.length) return
    if (group.some((g) => g.kind === 'tool' || g.kind === 'reasoning')) out.push(<Activity key={group[0].id} items={group} live={live} />)
    else for (const g of group) out.push(<div key={g.id} className="status-line">{g.text}</div>) // plain notes (checkpoint, paused...)
    group = []
  }
  for (const it of items) {
    if (it.kind === 'tool' || it.kind === 'reasoning' || it.kind === 'status' || it.kind === 'approval') {
      if (it.kind === 'approval') {
        flush(false)
        out.push(<ApprovalCard key={it.id} root={root} id={it.approvalId!} />)
      } else group.push(it)
      continue
    }
    flush(false)
    if (it.kind === 'user')
      out.push(
        <div key={it.id} className="msg user reveal">
          <div className="msg-text">{it.text}</div>
          {it.attachments?.length ? <div className="msg-atts">{it.attachments.map((a, i) => <span key={i} className="chip"><Paperclip size={11} /> {a.name}</span>)}</div> : null}
        </div>
      )
    else if (it.kind === 'assistant')
      out.push(
        <div key={it.id} className="msg assistant reveal">
          <div className="msg-who"><img src={iconUrl} alt="" className="avatar" /> Dahl
            <button className="icon-btn tiny msg-copy" aria-label="Copy message" onClick={() => navigator.clipboard.writeText(it.text)}><Copy size={12} /></button>
          </div>
          <Markdown text={it.text} />
        </div>
      )
    else if (it.kind === 'summary') out.push(<Summary key={it.id} root={root} item={it} />)
    else if (it.kind === 'agents') out.push(<AgentChips key={it.id} root={root} ids={it.agentIds ?? []} />)
    else if (it.kind === 'error') out.push(<div key={it.id} className="status-line error reveal"><CircleAlert size={13} /> {it.text}</div>)
  }
  flush(running)
  return <>{out}</>
}
