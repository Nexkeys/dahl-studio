// Provider and model helpers shared by main and renderer. Pure functions, no runtime imports.
import type { LocalProviderId, ModelInfo, ProviderId } from './types'

export const PROVIDER_NAME: Record<ProviderId, string> = {
  dahl: 'Dahl', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', nvidia: 'NVIDIA',
  groq: 'Groq', openrouter: 'OpenRouter', ollama: 'Ollama', lmstudio: 'LM Studio'
}

/** Display and sort order of providers everywhere (Settings, model menu, catalogue). */
export const PROVIDER_ORDER: ProviderId[] = ['dahl', 'openai', 'anthropic', 'gemini', 'nvidia', 'groq', 'openrouter', 'ollama', 'lmstudio']

export const LOCAL_PROVIDERS: LocalProviderId[] = ['ollama', 'lmstudio']
export const LOCAL_DEFAULT_URL: Record<LocalProviderId, string> = { ollama: 'http://localhost:11434', lmstudio: 'http://localhost:1234' }

export function isLocalProvider(p: string): p is LocalProviderId {
  return p === 'ollama' || p === 'lmstudio'
}

/** "openrouter:meta-llama/llama-3.3-70b-instruct:free" -> provider and model id (the id may contain ':' itself). */
export function splitModelKey(key: string): { provider: ProviderId; id: string } {
  const sep = key.indexOf(':')
  return sep > 0 ? { provider: key.slice(0, sep) as ProviderId, id: key.slice(sep + 1) } : { provider: 'dahl', id: key }
}

/**
 * A local server URL as the user typed it, made into a base without the API path: trims spaces and slashes, adds
 * http:// when missing and drops a trailing /v1 or /api (people paste the OpenAI-compatible URL). null when invalid.
 */
export function normalizeLocalBase(raw: string): string | null {
  let s = raw.trim().replace(/\/+$/, '')
  if (!s) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return null // ftp://, file:// ...
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  s = s.replace(/\/(v1|api|api\/v1)$/i, '')
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null
  } catch {
    return null
  }
}

/**
 * The model to use when the chosen one is no longer offered: the most recent one still listed, then a model from the
 * same provider, then a Dahl model, then the first model. Returns null when the current model is fine or nothing is listed.
 */
export function pickFallbackModel(current: string | null, models: ModelInfo[], recent: string[] = []): ModelInfo | null {
  if (!models.length) return null
  if (current && models.some((m) => m.key === current)) return null
  const has = (k: string) => models.find((m) => m.key === k)
  for (const k of recent) {
    const m = has(k)
    if (m && k !== current) return m
  }
  const provider = current ? splitModelKey(current).provider : null
  return models.find((m) => m.provider === provider) ?? models.find((m) => m.provider === 'dahl') ?? models[0]
}

/** Short context size label: 131072 -> "128k", 1000000 -> "1M". */
export function contextLabel(tokens?: number): string {
  if (!tokens || tokens <= 0) return ''
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  return `${Math.round(tokens / 1024)}k`
}
