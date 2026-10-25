import { useState } from 'react'
import { ChevronDown, Download, Plug, PlugZap, Power, ScrollText, Trash2, FlaskConical, ExternalLink, ShieldAlert, Globe, HardDrive, KeyRound } from 'lucide-react'
import type { McpCatalogEntry, McpServerConfig, McpStatus } from '@shared/types'
import { api, useStore } from '../store'

export const CLASS_LABEL: Record<string, string> = {
  included_local: 'Included local tool', optional_local: 'Optional local install', free_online: 'Free online, no API key',
  external_account: 'Needs your own account', paid: 'Paid / account-restricted', unverified: 'Unverified'
}

export interface TestResult { ok: boolean; at: string; tools: number; connectMs?: number; capability?: { tool: string; ok: boolean; excerpt: string }; error?: string }

export function McpCard({ entry, cfg, status, test, onChange }: { entry?: McpCatalogEntry; cfg?: McpServerConfig; status?: McpStatus; test?: TestResult; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[] | null>(null)
  const root = useStore((s) => s.settings?.activeProject ?? null)
  const notify = useStore.getState().notify
  const name = entry?.name ?? cfg?.name ?? 'Server'
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    try {
      await fn()
      onChange()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }
  const state = status?.state ?? 'stopped'
  const id = cfg?.id
  return (
    <div className={`mcp-card ${entry?.risk === 'high' ? 'high' : ''} reveal`}>
      <div className="mcp-head">
        <span className={`mcp-icon ${state}`}>{state === 'connected' ? <PlugZap size={16} /> : <Plug size={16} />}</span>
        <div className="grow">
          <div className="mcp-name">{name} {entry && <span className={`pill cls-${entry.classification}`}>{CLASS_LABEL[entry.classification]}</span>} {cfg?.custom && <span className="pill">Custom</span>}</div>
          <div className="muted small">{entry ? `${entry.publisher} · v${entry.version} · ${entry.license}` : cfg?.transport === 'http' ? cfg.url : `${cfg?.command} ${(cfg?.args ?? []).join(' ')}`}</div>
        </div>
        <span className={`state-dot ${state}`} title={status?.error ?? state} />
        <span className="small muted">{cfg ? (cfg.enabled ? state : 'disabled') : 'not installed'}</span>
      </div>
      {entry && <p className="small mcp-desc">{entry.description}</p>}
      <div className="mcp-facts small">
        {entry && <span><HardDrive size={12} /> {entry.runsWhere === 'local' ? 'Runs locally' : 'Remote'}</span>}
        {entry && <span><Globe size={12} /> Internet: {entry.needsInternet}</span>}
        {entry && <span><KeyRound size={12} /> {entry.needsAccount}</span>}
        {entry?.risk === 'high' && <span className="c-danger"><ShieldAlert size={12} /> High risk</span>}
      </div>
      {test && (
        <div className={`test-result ${test.ok ? 'ok' : 'bad'} small`}>
          <div><b>{test.ok ? 'Test passed' : 'Test failed'}</b> · {new Date(test.at).toLocaleString()} · {test.tools} tools{test.connectMs ? ` · connected in ${test.connectMs} ms` : ''}
            {test.capability && <div>Capability test <code>{test.capability.tool}</code>: {test.capability.ok ? 'works' : 'did not produce the expected result'}<pre className="mini-pre">{test.capability.excerpt}</pre></div>}
            {test.error && <div className="c-danger">{test.error}</div>}
          </div>
        </div>
      )}
      {status?.error && !test && <div className="error-text small">{status.error}</div>}
      <div className="row wrap">
        {entry && !cfg && entry.install && <button className="btn small primary" disabled={!!busy} onClick={() => act('install', () => api.invoke('mcp:install', entry.id))}><Download size={13} /> Add to Dahl</button>}
        {entry && !entry.install && <span className="muted small">Not installable from Dahl Studio: {entry.risks[0]}</span>}
        {cfg && <button className={`btn small ${cfg.enabled ? 'ghost' : 'primary'}`} disabled={!!busy} onClick={() => act('toggle', () => {
          if (!cfg.enabled && entry?.risk === 'high' && !window.confirm(`${name} is high risk: ${entry.risks.join(' ')} Enable anyway?`)) return Promise.resolve()
          if (!cfg.enabled && cfg.custom && !window.confirm(`Enable custom server?\n\nIt will run: ${cfg.transport === 'http' ? cfg.url : `${cfg.command} ${(cfg.args ?? []).join(' ')}`}\n\nOnly enable servers you trust.`)) return Promise.resolve()
          return api.invoke('mcp:update', cfg.id, { enabled: !cfg.enabled })
        })}><Power size={13} /> {cfg.enabled ? 'Disable' : 'Enable'}</button>}
        {cfg && <button className="btn small ghost" disabled={!!busy} onClick={() => act('test', () => api.invoke('mcp:test', cfg.id, root))}>{busy === 'test' ? <span className="spinner" /> : <FlaskConical size={13} />} Test</button>}
        {cfg && state === 'connected' && <button className="btn small ghost" onClick={() => act('stop', () => api.invoke('mcp:stop', cfg.id))}>Stop</button>}
        {cfg && <button className="btn small ghost" onClick={async () => setLogs(logs ? null : await api.invoke<string[]>('mcp:logs', cfg.id))}><ScrollText size={13} /> Logs</button>}
        {cfg && (
          <select className="input small" value={cfg.policy} onChange={(e) => act('policy', () => api.invoke('mcp:update', cfg.id, { policy: e.target.value }))} aria-label="Approval policy">
            <option value="ask">Ask before every call</option>
            <option value="readonly">Auto-allow read-only tools</option>
            <option value="allow">Never ask (trusted)</option>
          </select>
        )}
        {cfg && Object.keys(cfg.env ?? {}).map((k) => (
          <button key={k} className="btn small ghost" onClick={() => { const v = window.prompt(`Value for ${k} (stored encrypted, never sent to the AI model)`); if (v) void act('env', () => api.invoke('mcp:update', cfg.id, { env: { [k]: v } })) }}><KeyRound size={12} /> {k}{cfg.env![k] ? ' (set)' : ''}</button>
        ))}
        {cfg && <button className="icon-btn danger" title="Remove" aria-label="Remove" onClick={() => window.confirm(`Remove ${name}?`) && act('rm', () => api.invoke('mcp:remove', cfg.id))}><Trash2 size={14} /></button>}
        <span className="grow" />
        {entry && <button className="btn small ghost" onClick={() => setOpen(!open)}>Learn more <ChevronDown size={12} className={`chev-d ${open ? 'open' : ''}`} /></button>}
      </div>
      {logs && <pre className="mini-pre logs">{logs.join('\n') || 'No logs yet. Logs appear when the server starts.'}</pre>}
      {open && entry && (
        <div className="mcp-more small">
          <div><b>When Dahl uses it:</b> {entry.whenUsed.join('; ')}</div>
          <div><b>Try asking:</b> {entry.exampleTasks.map((t) => `"${t}"`).join(', ')}</div>
          <div><b>Requires:</b> {entry.requirements} · <b>Runtime:</b> {entry.runtime}</div>
          <div><b>Permissions:</b> {entry.permissions.join('; ')}</div>
          <div><b>Can access:</b> {entry.access}</div>
          <div><b>Data leaving your computer:</b> {entry.dataLeaves}</div>
          <div><b>Risks:</b> {entry.risks.join(' ')}</div>
          <div><a href={entry.source} target="_blank" rel="noreferrer">Source <ExternalLink size={11} /></a> · AI responses still use your selected model provider (Dahl API usage applies).</div>
        </div>
      )}
    </div>
  )
}
