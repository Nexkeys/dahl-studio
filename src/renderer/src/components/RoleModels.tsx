import { useEffect, useState } from 'react'
import type { ModelInfo, ModelRole, PriceRow } from '@shared/types'
import { PRICES_CHECKED } from '@shared/cost'
import { api, updateSettings, useStore } from '../store'
import { providerName } from './CostStatus'

const ROLES: { id: ModelRole | 'main'; label: string; hint: string }[] = [
  { id: 'main', label: 'Main agent', hint: 'Plans, talks to you and does most of the work (the model picked at the top of the window).' },
  { id: 'research', label: 'Search / Researcher', hint: 'Researcher helpers: code and web research.' },
  { id: 'helpers', label: 'Helpers', hint: 'Implementer, Debugger and Test Engineer helpers.' },
  { id: 'checker', label: 'Checker / Reviewer', hint: 'Code Reviewer and Security Reviewer helpers.' },
  { id: 'image', label: 'Image reading', hint: 'Describes images for analyze_image. Only models that accept images are listed.' },
  { id: 'autocomplete', label: 'Autocomplete', hint: 'Inline suggestions in the editor, for when that feature is on.' }
]

const NO_ROWS: PriceRow[] = []

/** "$1.25 / $10 per 1M", "$0.02 per 1M", "free (runs on this PC)" or "price unknown", from the dated price list. */
function priceHint(m: ModelInfo, rows: PriceRow[]): string {
  if (m.provider === 'dahl') return '$0.02 per 1M'
  if ((m.provider as string) === 'ollama' || (m.provider as string) === 'lmstudio') return 'free, runs on this PC'
  const id = m.id.toLowerCase().replace(/^models\//, '')
  const want = m.provider === 'anthropic' ? id.replace(/-(\d{8}|latest)$/, '') : id
  const r = rows.find((x) => x.provider === m.provider && x.model === want)
  return r ? `$${r.input} / $${r.output} per 1M` : 'price unknown'
}

function ModelSelect({ value, models, rows, sameAsMain, label, onChange }: { value: string; models: ModelInfo[]; rows: PriceRow[]; sameAsMain: boolean; label: string; onChange: (v: string) => void }) {
  const providers = [...new Set(models.map((m) => m.provider))]
  return (
    <select className="input small" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {sameAsMain && <option value="">Same as main</option>}
      {value && !models.some((m) => m.key === value) && <option value={value}>{value} (not available now)</option>}
      {providers.map((p) => (
        <optgroup key={p} label={providerName(p)}>
          {models.filter((m) => m.provider === p).map((m) => <option key={m.key} value={m.key}>{m.label} ({priceHint(m, rows)})</option>)}
        </optgroup>
      ))}
    </select>
  )
}

/** Settings > Usage: a model per role ("same as main" by default) and the price list behind the estimates. */
export function RoleModels() {
  const s = useStore((st) => st.settings)
  const models = useStore((st) => st.models)
  const [rows, setRows] = useState<PriceRow[]>(NO_ROWS)
  useEffect(() => void api.invoke<PriceRow[]>('cost:prices').then(setRows).catch(() => {}), [])
  if (!s) return null
  const setRole = (id: ModelRole, v: string) => void updateSettings({ roleModels: { ...s.roleModels, [id]: v || null } })
  return (
    <>
      <div className="settings-sub">Models per role</div>
      <p className="muted small">
        Give helpers a cheaper or faster model while the main agent keeps a strong one. Every role starts as "Same as main". The Economy and Balanced presets
        use these choices; Best runs every agent on the main model{s.qualityPreset === 'best' ? ' (Best is selected now, so helper, research and review models are not used)' : ''}.
      </p>
      <div className="cost-form">
        {ROLES.map((r) => (
          <RoleRow key={r.id} label={r.label} hint={r.hint}>
            {r.id === 'main'
              ? <ModelSelect value={s.defaultModel ?? ''} models={models} rows={rows} sameAsMain={false} label="Main agent model" onChange={(v) => void updateSettings({ defaultModel: v })} />
              : <ModelSelect value={s.roleModels?.[r.id] ?? ''} models={r.id === 'image' ? models.filter((m) => m.vision) : models} rows={rows} sameAsMain label={`${r.label} model`} onChange={(v) => setRole(r.id as ModelRole, v)} />}
          </RoleRow>
        ))}
      </div>
      <details>
        <summary className="small">Price list used for estimates ({rows.length} entries, checked {PRICES_CHECKED})</summary>
        <div className="price-list">
          <table>
            <thead><tr><th>Provider</th><th>Model</th><th>Input</th><th>Output</th><th>Cached</th><th>Cache write</th><th>Notes</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{providerName(r.provider)}</td><td className="mono">{r.model}</td><td>${r.input}</td><td>${r.output}</td>
                  <td>{r.cached !== undefined ? `$${r.cached}` : ''}</td><td>{r.cacheWrite !== undefined ? `$${r.cacheWrite}` : ''}</td>
                  <td className="note">{[r.period, r.tier, r.note, r.source.startsWith('http') ? '' : r.source].filter(Boolean).join('; ')}{r.source.startsWith('http') && <> <a href={r.source} target="_blank" rel="noreferrer">source</a></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">USD per 1M tokens, standard tier. Gemini prices are the paid tier (the free tier costs nothing). Prices change: the app never guesses a price that is not on this list.</p>
      </details>
    </>
  )
}

function RoleRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <>
      <span title={hint}>{label}</span>
      <div>{children}<div className="muted small">{hint}</div></div>
    </>
  )
}
