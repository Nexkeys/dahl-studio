// What the model menu in the composer shows for a search: pure, so it is unit-tested (tests/modelMenu.test.ts).
import type { KeyInfo, LocalProviderStatus, ModelInfo, ProviderId } from './types'
import { isLocalProvider, PROVIDER_NAME, PROVIDER_ORDER } from './models'

export type ModelBadge = 'vision' | 'tools' | 'free' | 'local' | 'new'
export type ProviderAccess = 'key' | 'no_key' | 'key_error' | 'running' | 'not_running'

export type MenuRow =
  | { kind: 'section'; id: string; label: string }
  | { kind: 'provider'; id: string; provider: ProviderId; name: string; count: number; total: number; expanded: boolean; access: ProviderAccess; accessLabel: string }
  | { kind: 'model'; id: string; model: ModelInfo; badges: ModelBadge[]; recent: boolean }

export interface MenuInput {
  models: ModelInfo[]
  query: string
  /** providers the user opened (ignored while searching: every provider with a hit is open) */
  expanded: readonly ProviderId[]
  /** recently picked model keys, newest first */
  recent: readonly string[]
  keys: readonly KeyInfo[]
  local: readonly LocalProviderStatus[]
}

export function modelBadges(m: ModelInfo): ModelBadge[] {
  const out: ModelBadge[] = []
  if (m.vision) out.push('vision')
  if (m.tools) out.push('tools')
  if (m.free) out.push('free')
  if (m.local) out.push('local')
  if (m.isNew) out.push('new')
  return out
}

/** Key or local-server status of a provider, for its row in the menu. */
export function providerAccess(p: ProviderId, keys: readonly KeyInfo[], local: readonly LocalProviderStatus[]): { access: ProviderAccess; label: string } {
  if (isLocalProvider(p)) {
    const s = local.find((l) => l.provider === p)
    if (s?.running) return { access: 'running', label: 'Running' }
    return { access: 'not_running', label: s ? 'Not running' : 'Not checked' }
  }
  const mine = keys.filter((k) => k.provider === p && k.configured)
  if (!mine.length) return { access: 'no_key', label: 'No key' }
  if (mine.every((k) => k.health === 'auth_failed' || k.health === 'exhausted')) return { access: 'key_error', label: mine[0].health === 'exhausted' ? 'No credit' : 'Key failed' }
  return { access: 'key', label: 'Key set' }
}

const tokensOf = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean)
const hit = (hay: string, tokens: string[]): boolean => tokens.every((t) => hay.includes(t))

function haystack(m: ModelInfo): string {
  return `${PROVIDER_NAME[m.provider]} ${m.provider} ${m.label} ${m.id} ${modelBadges(m).join(' ')}`.toLowerCase()
}

/**
 * Rows of the menu. Without a search: recently used models first, then every provider as a collapsed row (open ones
 * followed by their models). With a search (all words must match, in any order): a provider whose name matches shows
 * all its models; otherwise each provider shows only its matching models, and providers without a hit are left out.
 * Words like "free", "vision" or "local" match the badges.
 */
export function buildModelMenu(input: MenuInput): MenuRow[] {
  const tokens = tokensOf(input.query)
  const rows: MenuRow[] = []
  const byProvider = new Map<ProviderId, ModelInfo[]>()
  for (const m of input.models) byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m])
  const modelRow = (m: ModelInfo, recent: boolean): MenuRow => ({ kind: 'model', id: `${recent ? 'recent' : 'model'}:${m.key}`, model: m, badges: modelBadges(m), recent })

  if (!tokens.length) {
    const recent = input.recent.map((k) => input.models.find((m) => m.key === k)).filter((m): m is ModelInfo => !!m).slice(0, 5)
    if (recent.length) {
      rows.push({ kind: 'section', id: 'section:recent', label: 'Recently used' })
      for (const m of recent) rows.push(modelRow(m, true))
      rows.push({ kind: 'section', id: 'section:providers', label: 'Providers' })
    }
  }
  for (const p of PROVIDER_ORDER) {
    const all = byProvider.get(p) ?? []
    let shown = all
    if (tokens.length) {
      const nameHit = hit(`${PROVIDER_NAME[p]} ${p}`.toLowerCase(), tokens)
      shown = nameHit ? all : all.filter((m) => hit(haystack(m), tokens))
      if (!shown.length && !nameHit) continue
    }
    const expanded = tokens.length > 0 || input.expanded.includes(p)
    const { access, label } = providerAccess(p, input.keys, input.local)
    rows.push({ kind: 'provider', id: `provider:${p}`, provider: p, name: PROVIDER_NAME[p], count: shown.length, total: all.length, expanded, access, accessLabel: label })
    if (expanded) for (const m of shown) rows.push(modelRow(m, false))
  }
  return rows
}

/** Rows the keyboard can land on (providers and models, not section titles). */
export function selectableRows(rows: MenuRow[]): MenuRow[] {
  return rows.filter((r) => r.kind !== 'section')
}

/** Moves the highlight by `delta` among selectable rows, wrapping at both ends. */
export function moveHighlight(rows: MenuRow[], currentId: string | null, delta: number): string | null {
  const sel = selectableRows(rows)
  if (!sel.length) return null
  const i = sel.findIndex((r) => r.id === currentId)
  if (i < 0) return sel[delta < 0 ? sel.length - 1 : 0].id
  return sel[(i + delta + sel.length) % sel.length].id
}

/** Recently picked models after picking `key`: newest first, no duplicates, at most 8. */
export function pushRecent(recent: readonly string[] | undefined, key: string): string[] {
  return [key, ...(recent ?? []).filter((k) => k !== key)].slice(0, 8)
}
