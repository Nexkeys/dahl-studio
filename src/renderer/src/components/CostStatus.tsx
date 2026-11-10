import { useEffect, useState } from 'react'
import { Coins } from 'lucide-react'
import type { CostDay } from '@shared/types'
import { describeTally, formatUsd, PRICES_CHECKED } from '@shared/cost'
import { api, PROVIDER_NAMES, useStore } from '../store'
import '../ui-cost.css'

export function providerName(p: string): string {
  return (PROVIDER_NAMES as Record<string, string>)[p] ?? ({ openrouter: 'OpenRouter', groq: 'Groq', ollama: 'Ollama', lmstudio: 'LM Studio' } as Record<string, string>)[p] ?? p
}

/** Today's total in the status bar; the tooltip breaks it down by provider. Click opens Settings > Usage. */
export function CostStatus() {
  // usage changes after every model request, which is when today's total changes
  const usage = useStore((s) => s.usage)
  const limit = useStore((s) => s.settings?.budgetDayUsd ?? null)
  const set = useStore((s) => s.set)
  const [day, setDay] = useState<CostDay | null>(null)
  useEffect(() => {
    const t = setTimeout(() => void api.invoke<CostDay>('cost:today').then(setDay).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [usage])
  if (!day) return null
  const total = formatUsd(day.total)
  const lines = [
    `Spent today (${day.date}): ${total}${limit ? ` of your ${formatUsd({ usd: limit, requests: 1, unknown: 0, estimated: false })} daily limit` : ''}`,
    ...Object.entries(day.byProvider).sort((a, b) => b[1].usd - a[1].usd).map(([p, t]) => `${providerName(p)}: ${formatUsd(t)} (${describeTally(t)})`),
    day.total.requests ? `~ = estimate from list prices checked ${PRICES_CHECKED}; your provider's bill is authoritative.` : 'No model requests yet today.'
  ]
  const ratio = limit ? day.total.usd / limit : 0
  const open = () => {
    set({ view: 'settings' })
    setTimeout(() => document.getElementById('settings-usage')?.scrollIntoView({ block: 'start' }), 80)
  }
  return (
    <button className={`sb-btn sb-item cost-sb ${ratio >= 1 ? 'over' : ratio >= 0.8 ? 'near' : ''}`} title={lines.join('\n')} aria-label={`Spent today: ${total}. Open usage settings`} onClick={open}>
      <Coins size={12} /> {total} today
    </button>
  )
}
