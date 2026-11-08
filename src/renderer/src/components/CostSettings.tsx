import { useEffect, useState } from 'react'
import { Coins } from 'lucide-react'
import type { CostDay } from '@shared/types'
import { describeTally, emptyTally, formatUsd, localDate, mergeTally, PRICES_CHECKED } from '@shared/cost'
import { api, updateSettings, useStore } from '../store'
import { providerName } from './CostStatus'
import { RoleModels } from './RoleModels'
import '../ui-cost.css'

/** A dollar amount; empty or 0 means no limit. Saved when the field loses focus or on Enter. */
function MoneyInput({ value, label, onSave }: { value: number | null; label: string; onSave: (v: number | null) => void }) {
  const [text, setText] = useState(value ? String(value) : '')
  useEffect(() => setText(value ? String(value) : ''), [value])
  const commit = () => {
    const v = Number(text.replace(',', '.').replace(/^\$/, '').trim())
    if (!text.trim() || v === 0) return onSave(null)
    if (Number.isFinite(v) && v > 0) onSave(Math.round(v * 100) / 100)
    else setText(value ? String(value) : '')
  }
  return (
    <span className="money">$ <input className="input small" inputMode="decimal" placeholder="no limit" aria-label={label} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /></span>
  )
}

/** A whole number; 0 turns the note off. */
function CountInput({ value, label, unit, onSave }: { value: number; label: string; unit: string; onSave: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const v = Math.round(Number(text.replace(/[,\s]/g, '')))
    if (Number.isFinite(v) && v >= 0) onSave(v)
    else setText(String(value))
  }
  return (
    <span className="money"><input className="input small" inputMode="numeric" aria-label={label} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /> {unit}</span>
  )
}

/** Settings > Usage: spend by day and provider, budgets, notes before expensive steps, models per role, price list. */
export function CostSettings() {
  const s = useStore((st) => st.settings)
  const usage = useStore((st) => st.usage)
  const [days, setDays] = useState<CostDay[]>([])
  useEffect(() => {
    const t = setTimeout(() => void api.invoke<CostDay[]>('cost:recent', 7).then(setDays).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [usage])
  if (!s) return null
  const today = days.find((d) => d.date === localDate())?.total ?? emptyTally()
  const week = days.reduce((t, d) => mergeTally(t, d.total), emptyTally())
  return (
    <section id="settings-usage">
      <h2><Coins size={16} /> Usage and cost</h2>
      <p className="muted small">
        Measured on this computer from every model request. When a provider reports the charge (OpenRouter), that figure is used. Otherwise the cost is an
        estimate from list prices copied from each provider's pricing page on {PRICES_CHECKED}, shown with ~; your provider's bill is what counts. Models
        without a confirmed price show as unknown and are not added in. Dahl: $0.02 per 1M tokens on every model (from Dahl's own API message). Local models
        (Ollama, LM Studio) cost nothing. Anthropic requests use prompt caching; cache reads and writes are listed when the provider reports them.
      </p>
      <div className="cost-grid">
        <div className="cost-card"><span className="muted small">Today</span><span className="big">{formatUsd(today)}</span><span className="muted small">{describeTally(today)}</span></div>
        <div className="cost-card"><span className="muted small">Last {days.length || 7} days with use</span><span className="big">{formatUsd(week)}</span><span className="muted small">{describeTally(week)}</span></div>
      </div>
      {days.length > 0 && (
        <table className="cost-days">
          <thead><tr><th>Day</th><th>Total</th><th>By provider</th></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td className="num">{d.date}</td>
                <td className="num" title={describeTally(d.total)}>{formatUsd(d.total)}</td>
                <td>{Object.entries(d.byProvider).map(([p, t]) => `${providerName(p)} ${formatUsd(t)} (${t.requests} req.)`).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="settings-sub">Budgets</div>
      <p className="muted small">When a limit would be passed, the task pauses before its next model call with "Budget reached" and keeps its progress. Requests whose price is unknown cannot be counted.</p>
      <div className="cost-form">
        <span>Per task (one request, including its helpers)</span>
        <MoneyInput value={s.budgetTaskUsd} label="Budget per task in US dollars" onSave={(v) => void updateSettings({ budgetTaskUsd: v })} />
        <span>Per day (all chats and projects)</span>
        <MoneyInput value={s.budgetDayUsd} label="Budget per day in US dollars" onSave={(v) => void updateSettings({ budgetDayUsd: v })} />
      </div>

      <div className="settings-sub">Before expensive steps</div>
      <p className="muted small">A note appears in the chat (and in the task log) before a step this large. Set a value to 0 to turn that note off.</p>
      <div className="cost-form">
        <span>Requests larger than</span>
        <CountInput value={s.warnInputTokens} unit="input tokens" label="Note requests larger than this many input tokens" onSave={(v) => void updateSettings({ warnInputTokens: v })} />
        <span>Requests with more than</span>
        <CountInput value={s.warnImages} unit="images" label="Note requests with more images than this" onSave={(v) => void updateSettings({ warnImages: v })} />
        <span>More helper agents at once than</span>
        <CountInput value={s.warnHelpers} unit="helpers" label="Note when more helper agents than this start at once" onSave={(v) => void updateSettings({ warnHelpers: v })} />
      </div>
      <label className="check"><input type="checkbox" checked={s.confirmExpensive} onChange={(e) => void updateSettings({ confirmExpensive: e.target.checked })} /> Ask me before going ahead with such a step (otherwise the note is only shown)</label>

      <RoleModels />
    </section>
  )
}
