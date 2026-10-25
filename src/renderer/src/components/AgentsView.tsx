import { useEffect, useState } from 'react'
import { Compass, Hammer, Bug, FlaskConical, SearchCheck, ShieldAlert, Globe, Bot, ChevronRight, Users } from 'lucide-react'
import type { AgentInfo, AgentRole } from '@shared/types'
import { baseName, useStore } from '../store'
import { Markdown } from './Markdown'

const ROLE_ICON: Record<AgentRole, typeof Bot> = {
  lead: Bot, architect: Compass, implementer: Hammer, debugger: Bug, test_engineer: FlaskConical, code_reviewer: SearchCheck, security_reviewer: ShieldAlert, researcher: Globe
}

function elapsed(a: AgentInfo, now: number): string {
  const ms = (a.endedAt ? Date.parse(a.endedAt) : now) - Date.parse(a.startedAt)
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

export function AgentCard({ a, now }: { a: AgentInfo; now: number }) {
  const [open, setOpen] = useState(false)
  const Icon = ROLE_ICON[a.role] ?? Bot
  const live = a.status === 'thinking' || a.status === 'tool' || a.status === 'waiting_approval'
  return (
    <div className={`agent-card ${a.status}`}>
      <button className="agent-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`agent-icon ${live ? 'live' : ''}`}><Icon size={14} /></span>
        <span className="agent-name">{a.name}</span>
        <span className="agent-step">{a.status === 'done' ? 'Finished' : a.status === 'waiting_approval' ? 'Waiting for approval' : a.step}</span>
        <span className="muted small">{a.toolCount} tools · {elapsed(a, now)}</span>
        <ChevronRight size={13} className={`chev ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="agent-body">
          <div className="small"><b>Task:</b> {a.task}</div>
          {a.files.length > 0 && <div className="small muted">Owns: {a.files.join(', ')}</div>}
          {a.report && <Markdown text={a.report} />}
        </div>
      )}
    </div>
  )
}

/** Inline live status of delegated agents inside the chat. */
export function AgentChips({ root, ids }: { root: string; ids: string[] }) {
  const map = useStore((s) => s.projects[root]?.agents)
  const agents = ids.map((id) => map?.[id]).filter(Boolean) as AgentInfo[]
  const now = useNow(agents.some((a) => !a.endedAt))
  if (!agents.length) return null
  return (
    <div className="agents-inline reveal">
      <div className="agents-inline-head"><Users size={13} /> {agents.length} agents working in parallel</div>
      {agents.map((a) => <AgentCard key={a.id} a={a} now={now} />)}
    </div>
  )
}

export function AgentsView() {
  const projects = useStore((s) => s.projects)
  const all = Object.entries(projects).flatMap(([root, p]) => Object.values(p.agents).map((a) => ({ root, a })))
  const running = all.filter((x) => !x.a.endedAt)
  const done = all.filter((x) => x.a.endedAt).sort((x, y) => (y.a.endedAt ?? '').localeCompare(x.a.endedAt ?? ''))
  const now = useNow(running.length > 0)
  return (
    <div className="view">
      <h1><Users size={20} /> Agents</h1>
      <p className="muted small">Dahl delegates substantial work to specialised sub-agents (Architect, Implementer, Debugger, Test Engineer, Code Reviewer, Security Reviewer, Researcher) that run in parallel. Write-capable agents own specific files so they cannot overwrite each other, and every write still needs your approval.</p>
      <h2>Running ({running.length})</h2>
      {!running.length && <div className="empty-state compact"><div className="muted">No agents running. Ask for something like "Review this project for bugs and security issues in parallel".</div></div>}
      {running.map(({ root, a }) => <div key={a.id}><div className="muted small">{baseName(root)}</div><AgentCard a={a} now={now} /></div>)}
      <h2 style={{ marginTop: 24 }}>Completed this session ({done.length})</h2>
      {done.map(({ root, a }) => <div key={a.id}><div className="muted small">{baseName(root)}</div><AgentCard a={a} now={now} /></div>)}
    </div>
  )
}
