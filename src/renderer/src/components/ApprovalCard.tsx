import { useState } from 'react'
import { ShieldCheck, Plug, X } from 'lucide-react'
import { api, useStore } from '../store'

/**
 * Reject with optional feedback, typed inline (window.prompt() does not exist in Electron; it threw, so Reject did nothing).
 * First click opens the box, the second click (or Enter) rejects.
 */
export function RejectButton({ onReject, className = 'btn small ghost' }: { onReject: (feedback?: string) => void; className?: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  if (!open) return <button className={className} onClick={() => setOpen(true)}><X size={13} /> Reject</button>
  const done = () => onReject(text.trim() || undefined)
  return (
    <span className="reject-box">
      <input autoFocus value={text} placeholder="Optional: tell Dahl why, or what to do instead" aria-label="Reason for rejecting"
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') setOpen(false) }} />
      <button className={className} onClick={done}>Reject</button>
    </span>
  )
}

export function ApprovalCard({ root, id }: { root: string; id: string }) {
  const approval = useStore((s) => s.projects[root]?.approvals.find((a) => a.id === id))
  const patch = useStore((s) => s.patchProject)
  if (!approval) return null
  const decide = async (ok: boolean, feedback?: string) => {
    await api.invoke('agent:approve', id, ok, feedback)
    patch(root, (c) => ({ approvals: c.approvals.filter((a) => a.id !== id), reviewing: c.reviewing === id ? null : c.reviewing }))
  }
  return (
    <div className="approval-card reveal">
      <div className="approval-head">
        {approval.kind === 'mcp' ? <Plug size={14} /> : <ShieldCheck size={14} />}
        Approval needed{approval.agent && approval.agent !== 'Dahl' ? ` from ${approval.agent}` : ''}
      </div>
      {approval.kind === 'command' && <pre className="approval-cmd">{approval.command}</pre>}
      {approval.kind === 'write' && (
        <div className="small">{approval.before ? 'Modify' : 'Create'} <code>{approval.path}</code>{' '}
          <button className="link" onClick={() => patch(root, { reviewing: id })}>Review diff</button>
        </div>
      )}
      {approval.kind === 'mcp' && (
        <>
          <div className="small">Connector tool <b>{approval.tool}</b></div>
          <pre className="approval-cmd">{approval.args}</pre>
        </>
      )}
      {approval.kind === 'push' && approval.push && (
        <>
          <div className="small">Publish to GitHub (never force-pushed)</div>
          <pre className="approval-cmd">{`Remote:  ${approval.push.remote}\nBranch:  ${approval.push.branch}${approval.push.target !== approval.push.branch ? ` -> ${approval.push.target}` : ''}\nCommits: ${approval.push.commits}${approval.push.commitMessage ? ` + new commit of ${approval.push.pending >= 0 ? `${approval.push.pending} changed file(s)` : 'all files (new repository)'}: "${approval.push.commitMessage}"` : ''}\nSign-in: ${approval.push.auth}`}</pre>
        </>
      )}
      {approval.reason && <div className="muted small">{approval.reason}</div>}
      <div className="row-actions end">
        <RejectButton onReject={(f) => void decide(false, f)} />
        <button className="btn small primary" onClick={() => decide(true)}>{approval.kind === 'command' ? 'Run command' : approval.kind === 'mcp' ? 'Allow' : approval.kind === 'push' ? 'Push' : 'Apply change'}</button>
      </div>
    </div>
  )
}
