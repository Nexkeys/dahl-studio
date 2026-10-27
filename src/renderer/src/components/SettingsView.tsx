import { useEffect, useState } from 'react'
import { KeyRound, RefreshCw, Trash2, CheckCircle2, XCircle, ShieldCheck, Palette, Cpu, Eye, Brain, Sparkles } from 'lucide-react'
import type { EffectsMode, KeyInfo, KeyTestResult, ThemeId } from '@shared/types'
import { api, loadModels, PROVIDER_NAMES, updateSettings, useStore } from '../store'
import { THEMES, applyEffects, applyTheme, isLowEnd, type Theme } from '../themes'

const KEY_HELP: Record<string, string> = {
  primary: 'Main Dahl key. Used first for Dahl models.',
  secondary: 'Backup Dahl key. Used automatically if the preferred key fails (auth, no tokens, rate limit, outage).',
  openai: 'platform.openai.com API key (sk-...). Unlocks OpenAI models.',
  anthropic: 'console.anthropic.com API key. Unlocks Claude models.',
  gemini: 'aistudio.google.com API key. Unlocks Gemini models.',
  nvidia: 'build.nvidia.com API key (nvapi-...). Unlocks NVIDIA-hosted models.'
}

function KeyCard({ k }: { k: KeyInfo }) {
  const settings = useStore((s) => s.settings)!
  const usage = useStore((s) => s.usage?.[k.slot])
  const [value, setValue] = useState('')
  const [name, setName] = useState(k.name)
  const [result, setResult] = useState<KeyTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const { set, notify } = useStore.getState()

  const test = async () => {
    setBusy(true)
    try {
      const r = await api.invoke<KeyTestResult>('keys:test', k.slot)
      setResult(r)
      if (r.ok && k.provider !== 'dahl') void loadModels()
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    try {
      set({ keys: await api.invoke<KeyInfo[]>('keys:set', k.slot, value.trim() ? value.trim() : null, name) })
      const had = !!value.trim()
      setValue('')
      notify('Saved to Windows-protected storage.')
      if (had) await test()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    if (!window.confirm(`Remove the ${k.name} key from this computer?`)) return
    set({ keys: await api.invoke<KeyInfo[]>('keys:clear', k.slot) })
    setResult(null)
  }
  return (
    <div className="card key-card">
      <div className="card-head">
        <KeyRound size={15} />
        <input className="inline-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== k.name && api.invoke('keys:set', k.slot, null, name)} aria-label="Key name" />
        <span className={`pill ${k.health}`}>{k.configured ? healthLabel(k.health) : 'Not set'}</span>
        {k.provider === 'dahl' && <label className="radio small"><input type="radio" checked={settings.preferredKey === k.slot} onChange={() => updateSettings({ preferredKey: k.slot as 'primary' | 'secondary' })} /> Preferred</label>}
      </div>
      <div className="muted small">{KEY_HELP[k.slot]}</div>
      <div className="row">
        <input type="password" className="input grow" placeholder={k.configured ? 'Stored securely. Paste a new key to replace it.' : 'Paste API key'} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} />
        <button className="btn primary" onClick={save} disabled={busy || (!value.trim() && name === k.name)}>Save</button>
        <button className="btn ghost" onClick={test} disabled={busy || !k.configured}>{busy ? <span className="spinner" /> : null} Test</button>
        {k.configured && <button className="icon-btn danger" title="Remove key" aria-label="Remove key" onClick={clear}><Trash2 size={15} /></button>}
      </div>
      {result && (
        <div className={`test-result ${result.ok ? 'ok' : 'bad'} reveal`}>
          {result.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          <div>
            <b>{result.ok ? `Connected${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}` : `Failed${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}`}</b>
            <div className="small">{result.ok ? result.summary : result.error}</div>
          </div>
        </div>
      )}
      {!result && k.lastError && <div className="error-text small">{k.lastError}</div>}
      {usage && (
        <div className="muted small">Measured locally: {usage.requests} requests, {usage.errors} errors, {(usage.promptTokens + usage.completionTokens).toLocaleString()} tokens{usage.estimated ? ' (includes estimates)' : ''}. Provider balance comes only from Test.</div>
      )}
    </div>
  )
}

function healthLabel(h: KeyInfo['health']): string {
  return { unknown: 'Saved', ok: 'Connected', auth_failed: 'Auth failed', exhausted: 'No tokens / quota', rate_limited: 'Rate limited', error: 'Error' }[h]
}

export function ThemePreview({ t, on, onPick }: { t: Theme; on: boolean; onPick: () => void }) {
  const v = t.vars
  return (
    <button className={`theme-card ${on ? 'on' : ''}`} onClick={onPick} aria-pressed={on}>
      <div className="tp" data-effect={t.effect} style={{ background: v['--bg'], borderRadius: v['--radius'], fontFamily: v['--font'] }}>
        <div className="tp-rail" style={{ background: v['--surface'], borderColor: v['--border'] }}><i style={{ background: v['--accent'] }} /><i style={{ background: v['--border'] }} /><i style={{ background: v['--border'] }} /></div>
        <div className="tp-editor" style={{ background: v['--editor-bg'], borderColor: v['--border'] }}>
          <span style={{ color: v['--syn-keyword'] }}>const</span> <span style={{ color: v['--text'] }}>app</span> <span style={{ color: v['--muted'] }}>=</span> <span style={{ color: v['--syn-func'] }}>dahl</span><span style={{ color: v['--muted'] }}>(</span><span style={{ color: v['--syn-string'] }}>'ship'</span><span style={{ color: v['--muted'] }}>)</span>
          <br /><span style={{ color: v['--syn-comment'] }}>// {t.tagline.split(',')[0]}</span>
        </div>
        <div className="tp-chat" style={{ background: v['--surface'], borderColor: v['--border'] }}>
          <div style={{ background: v['--surface-2'], borderRadius: v['--radius'] }} />
          <div style={{ background: v['--accent'], borderRadius: v['--radius'] }} />
        </div>
      </div>
      <div className="tp-name">{t.name}</div>
      <div className="tp-tag">{t.tagline}</div>
    </button>
  )
}

export function SettingsView() {
  const s = useStore((st) => st.settings)
  const keys = useStore((st) => st.keys)
  const models = useStore((st) => st.models)
  const errors = useStore((st) => st.modelErrors)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<{ version: string; appDataDir: string; encryption: boolean } | null>(null)
  useEffect(() => void api.invoke<typeof info>('app:info').then(setInfo), [])
  if (!s) return null
  const providers = [...new Set(models.map((m) => m.provider))]
  return (
    <div className="view">
      <h1>Settings</h1>
      <section>
        <h2><KeyRound size={16} /> API keys</h2>
        <p className="muted small">Keys are encrypted with Windows DPAPI{info && !info.encryption ? ' (unavailable on this system)' : ''}, never shown, logged, sent to a model or passed to tools. Dahl keys fail over between each other; other providers never act as a silent fallback for Dahl.</p>
        <div className="key-grid">{keys.map((k) => <KeyCard key={k.slot} k={k} />)}</div>
      </section>
      <section>
        <h2><Cpu size={16} /> Models <button className="btn small ghost" disabled={busy} onClick={async () => { setBusy(true); await loadModels(true); setBusy(false) }}>{busy ? <span className="spinner" /> : <RefreshCw size={13} />} Refresh</button></h2>
        <p className="muted small">Discovered live from each provider for your keys, refreshed every 30 minutes. Newly released models appear automatically, marked New. <Eye size={11} /> = accepts images, <Brain size={11} /> = native reasoning control.</p>
        {Object.entries(errors).map(([p, e]) => <div key={p} className="error-text small">{PROVIDER_NAMES[p as keyof typeof PROVIDER_NAMES]}: {e}</div>)}
        {providers.map((p) => (
          <div key={p} className="model-group">
            <div className="label">{PROVIDER_NAMES[p]} · {models.filter((m) => m.provider === p).length} models</div>
            <div className="model-list">
              {models.filter((m) => m.provider === p).map((m) => (
                <button key={m.key} className={`model-chip ${s.defaultModel === m.key ? 'on' : ''}`} onClick={() => updateSettings({ defaultModel: m.key })} title={m.id}>
                  <span className="ellipsis">{m.label}</span>
                  {m.vision && <Eye size={11} />}{m.thinking === 'native' && <Brain size={11} />}{m.isNew && <span className="pill new"><Sparkles size={9} /> New</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
      <section>
        <h2><ShieldCheck size={16} /> Behaviour</h2>
        <label className="check"><input type="checkbox" checked={s.notifications} onChange={(e) => updateSettings({ notifications: e.target.checked })} /> Windows notifications when Dahl needs approval, finishes, fails or pauses (only while Dahl Studio is in the background) <button className="btn tiny ghost" onClick={async (e) => { e.preventDefault(); const ok = await api.invoke<boolean>('notify:test'); if (!ok) useStore.getState().notify('Notifications are not supported or are blocked in Windows settings', 'error') }}>Send test notification</button></label>
        <label className="check"><input type="checkbox" checked={s.maintainProgress} onChange={(e) => updateSettings({ maintainProgress: e.target.checked })} /> Keep a PROGRESS.md work log in each project (task, plan, results, next steps; read back at the start of every task)</label>
        <label className="check"><input type="checkbox" checked={s.autoMemory} onChange={(e) => updateSettings({ autoMemory: e.target.checked })} /> Learn project memory automatically after tasks (one small extra model call)</label>
        <label className="check"><input type="checkbox" checked={s.autoApproveWrites} onChange={(e) => updateSettings({ autoApproveWrites: e.target.checked })} /> Apply file changes without asking (not recommended)</label>
        <label className="check"><input type="checkbox" checked={s.autoApproveCommands} onChange={(e) => updateSettings({ autoApproveCommands: e.target.checked })} /> Run agent commands without asking (not recommended)</label>
      </section>
      <section>
        <h2><Palette size={16} /> Theme</h2>
        <div className="theme-grid">
          {THEMES.map((t) => <ThemePreview key={t.id} t={t} on={s.theme === t.id} onPick={() => { applyTheme(t.id as ThemeId); void updateSettings({ theme: t.id }) }} />)}
        </div>
        <label className="check">Visual effects
          <select className="input small" value={s.effects} onChange={(e) => { const v = e.target.value as EffectsMode; applyEffects(v); void updateSettings({ effects: v }) }}>
            <option value="auto">Automatic ({isLowEnd() ? 'reduced on this PC' : 'full on this PC'})</option>
            <option value="full">Full</option>
            <option value="reduced">Reduced: no blur or animated backgrounds (faster on slow PCs)</option>
          </select>
        </label>
      </section>
      {info && <p className="muted small">Dahl Studio {info.version}. App data: {info.appDataDir}</p>}
    </div>
  )
}
