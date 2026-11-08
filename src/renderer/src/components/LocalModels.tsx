import { useEffect, useState } from 'react'
import { Laptop, RefreshCw, Eye, Wrench, Brain, TriangleAlert } from 'lucide-react'
import type { LocalProviderId, LocalProviderStatus, ModelInfo } from '@shared/types'
import { contextLabel, LOCAL_DEFAULT_URL, LOCAL_PROVIDERS, normalizeLocalBase, PROVIDER_NAME } from '@shared/models'
import { api, updateSettings, useStore } from '../store'
import '../ui-models.css'

type Listing = { local?: LocalProviderStatus[] }

const NOTES: Record<LocalProviderId, { start: string; how: string }> = {
  ollama: {
    start: 'Start Ollama (it runs in the system tray), or install it from ollama.com and pull a model, for example "ollama pull qwen3".',
    how: 'Dahl Studio talks to Ollama through its native API and asks for a 32k context on every request (or the model\'s maximum if that is smaller), so agent prompts are not cut at Ollama\'s default of 4k. Models without the tools capability get the tools described in the prompt instead.'
  },
  lmstudio: {
    start: 'In LM Studio, open the Developer tab and start the server (or run "lms server start").',
    how: 'LM Studio sets the context length when it loads a model; agent prompts need at least 16k. Tool calls that a model writes as text are turned into real tool calls.'
  }
}

/** Settings > Local models: whether Ollama and LM Studio are running, their address, and the models they offer. */
export function LocalModels() {
  const urls = useStore((s) => s.settings?.localUrls)
  const models = useStore((s) => s.models)
  const [status, setStatus] = useState<LocalProviderStatus[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => void api.invoke<Listing>('models:list').then((l) => setStatus(l.local ?? [])).catch(() => {}), [])
  const check = async () => {
    setBusy(true)
    try {
      setStatus((await api.invoke<Listing>('models:checkLocal')).local ?? [])
    } catch (e) {
      useStore.getState().notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const saveUrl = async (p: LocalProviderId, raw: string) => {
    const base = raw.trim() ? normalizeLocalBase(raw) : LOCAL_DEFAULT_URL[p]
    if (!base) return useStore.getState().notify(`"${raw}" is not a valid address. Use something like ${LOCAL_DEFAULT_URL[p]}`, 'error')
    if (base === (urls?.[p] ?? LOCAL_DEFAULT_URL[p])) return
    await updateSettings({ localUrls: { ...(urls ?? {}), [p]: base } })
    await check()
  }
  return (
    <section>
      <h2><Laptop size={16} /> Local models <button className="btn small ghost" disabled={busy} onClick={() => void check()}>{busy ? <span className="spinner" /> : <RefreshCw size={13} />} Check now</button></h2>
      <p className="muted small">Models running on this PC need no key and send nothing to the internet. Dahl Studio checks for them at startup, every 30 minutes and when you click Check now.</p>
      <div className="key-grid">
        {LOCAL_PROVIDERS.map((p) => (
          <LocalCard key={p} p={p} status={status.find((s) => s.provider === p)} url={urls?.[p] ?? LOCAL_DEFAULT_URL[p]} models={models} onSave={(v) => void saveUrl(p, v)} />
        ))}
      </div>
    </section>
  )
}

function LocalCard({ p, status, url, models, onSave }: { p: LocalProviderId; status?: LocalProviderStatus; url: string; models: ModelInfo[]; onSave: (v: string) => void }) {
  const [value, setValue] = useState(url)
  useEffect(() => setValue(url), [url])
  const list = models.filter((m) => m.provider === p)
  const running = !!status?.running
  return (
    <div className="card key-card local-card">
      <div className="card-head">
        <span className={`local-dot ${running ? 'on' : ''}`} />
        <b>{PROVIDER_NAME[p]}</b>
        <span className={`pill ${running ? 'ok' : status?.error ? 'error' : ''}`}>{running ? `Running, ${list.length} ${list.length === 1 ? 'model' : 'models'}` : status?.error ? 'Error' : status ? 'Not running' : 'Not checked yet'}</span>
      </div>
      <div className="row">
        <input className="input grow" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => onSave(value)} onKeyDown={(e) => e.key === 'Enter' && onSave(value)}
          aria-label={`${PROVIDER_NAME[p]} address`} spellCheck={false} placeholder={LOCAL_DEFAULT_URL[p]} />
      </div>
      {status?.error && <div className="error-text small">{status.error}</div>}
      {!running && !status?.error && <div className="muted small">{NOTES[p].start}</div>}
      {status?.smallContext && (
        <div className="small" style={{ color: 'var(--warn)' }}><TriangleAlert size={12} /> A model is loaded with a {contextLabel(status.smallContext)} context. Agent prompts are larger, so the start of each prompt is lost. In LM Studio, reload it with Context Length 16384 or more.</div>
      )}
      <div className="muted small">{NOTES[p].how}</div>
      {list.length > 0 && (
        <div className="model-list">
          {list.map((m) => (
            <span key={m.key} className="model-chip" title={m.id}>
              <span className="ellipsis">{m.label}</span>
              {m.tools && <Wrench size={11} aria-label="tools" />}{m.vision && <Eye size={11} aria-label="vision" />}{m.reasoning && <Brain size={11} aria-label="reasoning" />}
              {m.contextTokens ? <span className="muted">{contextLabel(m.contextTokens)}</span> : null}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
