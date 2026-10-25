import { ShieldCheck, Plug } from 'lucide-react'
import { api, useStore } from '../store'

export function ApprovalCard({ root, id }: { root: string; id: string }) {
  const approval = useStore((s) => s.projects[root]?.approvals.find((a) => a.id === id))
  const patch = useStore((s) => s.patchProject)
  if (!approval) return null
  const decide = async (ok: boolean) => {
    const feedback = ok ? undefined : window.prompt('Optional: tell Dahl why, or what to do instead') ?? undefined
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
      {approval.reason && <div className="muted small">{approval.reason}</div>}
      <div className="row-actions end">
        <button className="btn small ghost" onClick={() => decide(false)}>Reject</button>
        <button className="btn small primary" onClick={() => decide(true)}>{approval.kind === 'command' ? 'Run command' : approval.kind === 'mcp' ? 'Allow' : 'Apply change'}</button>
      </div>
    </div>
  )
}
