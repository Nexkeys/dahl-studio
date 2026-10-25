import { useEffect, useState } from 'react'
import { Boxes, Plus, Upload, Download, ShieldAlert } from 'lucide-react'
import type { McpCatalogEntry, McpServerConfig, McpStatus } from '@shared/types'
import { api, useStore } from '../store'
import { McpCard, type TestResult } from './McpCard'

interface ListResult { servers: McpServerConfig[]; tests: Record<string, TestResult>; status: McpStatus[] }

export function ToolboxView() {
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([])
  const [list, setList] = useState<ListResult>({ servers: [], tests: {}, status: [] })
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', transport: 'stdio' as 'stdio' | 'http', command: '', args: '', url: '', env: '' })
  const notify = useStore.getState().notify
  const reload = () => api.invoke<ListResult>('mcp:list').then(setList)
  useEffect(() => {
    void api.invoke<McpCatalogEntry[]>('mcp:catalog').then(setCatalog)
    void reload()
    return window.dahl.on('mcp:changed' as never, (l: ListResult) => setList(l))
  }, [])
  const statusFor = (id: string) => list.status.find((s) => s.id === id || s.id.startsWith(`${id}|`))
  const groups: [string, (e: McpCatalogEntry) => boolean][] = [
    ['Core local tools (available now)', (e) => e.classification === 'included_local'],
    ['Free online and optional installs', (e) => e.classification === 'free_online' || e.classification === 'optional_local'],
    ['Your own accounts', (e) => e.classification === 'external_account' || e.classification === 'paid'],
    ['Unverified / high risk (not installable)', (e) => e.classification === 'unverified']
  ]
  const addCustom = async () => {
    try {
      const env = Object.fromEntries(form.env.split('\n').map((l) => l.split('=')).filter((p) => p[0]?.trim()).map(([k, ...v]) => [k.trim(), v.join('=').trim()]))
      await api.invoke('mcp:addCustom', { name: form.name || 'Custom server', transport: form.transport, command: form.command.trim(), args: form.args.match(/("[^"]*"|\S+)/g)?.map((a) => a.replace(/^"|"$/g, '')) ?? [], url: form.url.trim(), env, policy: 'ask' })
      setAdding(false)
      setForm({ name: '', transport: 'stdio', command: '', args: '', url: '', env: '' })
      void reload()
      notify('Added (disabled). Review it, then Enable and Test.')
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const exportCfg = async () => {
    const json = await api.invoke<string>('mcp:export')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = 'dahl-mcp-config.json'
    a.click()
  }
  const importCfg = () => {
    const i = document.createElement('input')
    i.type = 'file'
    i.accept = '.json'
    i.onchange = async () => {
      try {
        const n = await api.invoke<number>('mcp:import', await i.files![0].text())
        notify(`Imported ${n} server(s), all disabled until you review them.`)
        void reload()
      } catch (e) {
        notify((e as Error).message, 'error')
      }
    }
    i.click()
  }
  const custom = list.servers.filter((s) => s.custom)
  return (
    <div className="view wide">
      <h1><Boxes size={20} /> Dahl Free Toolbox</h1>
      <p className="muted small">Connectors (MCP servers) give Dahl extra abilities. Nothing starts with the app: enabled connectors start only when a Build task needs them. Each is classified by what it really needs; "free" means its advertised function was tested to work without a paid account or key. Your AI model usage is separate. Web search is also built in (Web toggle in the chat).</p>
      {groups.map(([title, f]) => {
        const items = catalog.filter(f)
        if (!items.length) return null
        return (
          <section key={title}>
            <h2>{title}</h2>
            <div className="mcp-grid">
              {items.map((e) => {
                const cfg = list.servers.find((s) => s.catalogId === e.id)
                return <McpCard key={e.id} entry={e} cfg={cfg} status={cfg && statusFor(cfg.id)} test={cfg && list.tests[cfg.id]} onChange={reload} />
              })}
            </div>
          </section>
        )
      })}
      <section>
        <h2>Custom connectors
          <button className="btn small ghost" onClick={() => setAdding(!adding)}><Plus size={13} /> Add</button>
          <button className="btn small ghost" onClick={importCfg}><Upload size={13} /> Import</button>
          <button className="btn small ghost" onClick={exportCfg}><Download size={13} /> Export</button>
        </h2>
        {adding && (
          <div className="card reveal">
            <div className="note"><ShieldAlert size={14} /> <span>MCP servers are external code. Only add servers you trust. New servers start disabled; Dahl asks before every tool call and never passes your AI keys to them.</span></div>
            <div className="row"><input className="input grow" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="input" value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value as 'stdio' | 'http' })}><option value="stdio">Local (STDIO)</option><option value="http">Remote (Streamable HTTP)</option></select></div>
            {form.transport === 'stdio' ? (
              <div className="row"><input className="input" placeholder="Command (e.g. npx)" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
                <input className="input grow" placeholder='Arguments (e.g. -y some-mcp@1.2.3 "${project}")' value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} /></div>
            ) : <div className="row"><input className="input grow" placeholder="https://example.com/mcp" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>}
            <textarea className="input area" placeholder={'Environment variables, one per line: NAME=value\n(values are stored encrypted)'} value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} />
            <div className="row"><button className="btn primary" onClick={addCustom}>Add connector</button><span className="muted small">Pin versions (package@1.2.3). Use ${'{project}'} for the open project folder.</span></div>
          </div>
        )}
        <div className="mcp-grid">{custom.map((c) => <McpCard key={c.id} cfg={c} status={statusFor(c.id)} test={list.tests[c.id]} onChange={reload} />)}</div>
        {!custom.length && !adding && <div className="muted small">No custom connectors.</div>}
      </section>
    </div>
  )
}
