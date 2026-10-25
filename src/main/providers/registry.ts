import path from 'node:path'
import type { KeySlot, KeyTestResult, KeyUsageLocal, ModelInfo, ProviderId, ThinkingLevel } from '@shared/types'
import { classifyHttpError, DAHL_DOCUMENTED_CONTEXT, DahlError, extractRemaining, getKeyBalance, listModels as listDahlModels, streamChat, type ChatRequest, type ChatResult, type StreamCallbacks } from '../dahl/client'
import { DahlRouter } from '../dahl/router'
import { ANTHROPIC_BASE, anthropicHeaders, anthropicStream } from './anthropic'
import { nowIso, readJson, writeJson } from '../util'

export const PROVIDER_INFO: Record<ProviderId, { name: string; base: string; slot: KeySlot; docs: string }> = {
  dahl: { name: 'Dahl', base: 'https://inference.dahl.global/v1', slot: 'primary', docs: 'Dahl-Studio-Product-Pack/docs/Dahl_API_DOCS.md' },
  openai: { name: 'OpenAI', base: 'https://api.openai.com/v1', slot: 'openai', docs: 'https://platform.openai.com/docs/api-reference/chat' },
  anthropic: { name: 'Anthropic', base: ANTHROPIC_BASE, slot: 'anthropic', docs: 'https://docs.anthropic.com/en/api/messages' },
  gemini: { name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', slot: 'gemini', docs: 'https://ai.google.dev/gemini-api/docs/openai' },
  nvidia: { name: 'NVIDIA', base: 'https://integrate.api.nvidia.com/v1', slot: 'nvidia', docs: 'https://docs.api.nvidia.com/nim/reference' }
}

type RawModel = Omit<ModelInfo, 'key' | 'firstSeenAt' | 'isNew'>

const NON_CHAT = /(embed|embedding|tts|whisper|dall-e|davinci|babbage|audio|realtime|moderation|transcribe|image-|imagen|aqa|rerank|reward|guard|safety|clip|nemoretriever|parse|retriever|veo|lyria|sora|search-preview|computer-use|-detector)/i

function oaVision(id: string): boolean {
  return /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4\.5|gpt-5|gpt-6|chatgpt-4o|^o1(?!-mini)|^o3(?!-mini)|^o4)/i.test(id)
}
function oaThinking(id: string): boolean {
  return /(^o\d|gpt-5|gpt-6)/i.test(id)
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  let res: Response
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
  } catch (e) {
    throw new DahlError('network', `Could not reach ${new URL(url).host}: ${(e as Error).message}`)
  }
  const text = await res.text()
  if (!res.ok) throw classifyHttpError(res.status, text, res.headers.get('retry-after'))
  return { status: res.status, body: JSON.parse(text) }
}

/** Fetch the live model list for a provider. Returns only chat-capable models. */
export async function fetchProviderModels(provider: ProviderId, key: string | null): Promise<RawModel[]> {
  switch (provider) {
    case 'dahl':
      return (await listDahlModels()).map((m) => ({ provider, id: m.id, label: m.id, vision: false, thinking: 'app' as const, contextTokens: DAHL_DOCUMENTED_CONTEXT[m.id] }))
    case 'openai': {
      const { body } = await getJson(`${PROVIDER_INFO.openai.base}/models`, { Authorization: `Bearer ${key}` })
      return (body.data ?? [])
        .map((m: any) => String(m.id))
        .filter((id: string) => /^(gpt|o\d|chatgpt)/i.test(id) && !NON_CHAT.test(id))
        .map((id: string) => ({ provider, id, label: id, vision: oaVision(id), thinking: oaThinking(id) ? 'native' : 'app' }))
    }
    case 'anthropic': {
      const out: RawModel[] = []
      let after: string | undefined
      for (let page = 0; page < 5; page++) {
        const { body } = await getJson(`${ANTHROPIC_BASE}/models?limit=1000${after ? `&after_id=${after}` : ''}`, anthropicHeaders(key!))
        for (const m of body.data ?? []) {
          const caps = m.capabilities ?? {}
          const types: string[] = caps.thinking?.types ?? (Array.isArray(caps.thinking) ? caps.thinking : [])
          out.push({
            provider,
            id: m.id,
            label: m.display_name ?? m.id,
            vision: caps.image_input ?? true,
            thinking: types.length || /claude-(3-7|sonnet-4|opus-4|haiku-4|[4-9])/i.test(m.id) ? 'native' : 'app',
            contextTokens: m.max_input_tokens,
            maxOutputTokens: m.max_tokens,
            thinkingTypes: types.length ? types : undefined
          })
        }
        if (!body.has_more) break
        after = body.last_id
      }
      return out
    }
    case 'gemini': {
      let ids: { id: string; label: string; ctx?: number; out?: number }[] = []
      try {
        const { body } = await getJson(`${PROVIDER_INFO.gemini.base}/models`, { Authorization: `Bearer ${key}` })
        ids = (body.data ?? []).map((m: any) => ({ id: String(m.id).replace(/^models\//, ''), label: String(m.id).replace(/^models\//, '') }))
      } catch (e) {
        if ((e as DahlError).kind === 'auth') throw e
        // Fallback: native Gemini models list
        const { body } = await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { 'x-goog-api-key': key! })
        ids = (body.models ?? [])
          .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
          .map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName ?? m.name, ctx: m.inputTokenLimit, out: m.outputTokenLimit }))
      }
      return ids
        .filter((m) => /gemini|gemma/i.test(m.id) && !NON_CHAT.test(m.id))
        .map((m) => ({ provider, id: m.id, label: m.label, vision: /gemini/i.test(m.id), thinking: /gemini-(2\.5|[3-9])/i.test(m.id) ? 'native' : 'app', contextTokens: m.ctx, maxOutputTokens: m.out }))
    }
    case 'nvidia': {
      const { body } = await getJson(`${PROVIDER_INFO.nvidia.base}/models`, key ? { Authorization: `Bearer ${key}` } : {})
      return (body.data ?? [])
        .map((m: any) => String(m.id))
        .filter((id: string) => !NON_CHAT.test(id))
        .map((id: string) => ({
          provider,
          id,
          label: id,
          vision: /(vision|[-_]vl\b|-vl-|vila|neva|fuyu|kosmos|paligemma|llama-4|multimodal|gemma-3)/i.test(id),
          thinking: /(nemotron|deepseek-r1|qwq|qwen3|reason|think|magistral|gpt-oss)/i.test(id) ? 'native' : 'app'
        }))
    }
  }
}

export interface RegistryDeps {
  appDir: string
  getKey(slot: KeySlot): Promise<string | null>
  getPreferred(): Promise<'primary' | 'secondary'>
  onUsage(slot: KeySlot, u: Partial<KeyUsageLocal> & { ok: boolean }): void
  onHealth(slot: KeySlot, h: 'ok' | 'auth_failed' | 'exhausted' | 'rate_limited' | 'error', err?: string): void
  onModels(models: ModelInfo[]): void
}

interface CacheFile {
  seen: Record<string, string>
  models: ModelInfo[]
  errors: Partial<Record<ProviderId, string>>
  fetchedAt?: string
}

/**
 * Live model catalogue across providers. Refreshes on start, when a key is saved, on demand and every
 * 30 minutes, so models a provider newly enables for the key appear automatically (flagged "new").
 */
export class ModelRegistry {
  private file: string
  private cache: CacheFile = { seen: {}, models: [], errors: {} }
  private loaded = false
  private dahl: DahlRouter
  private timer: NodeJS.Timeout | null = null

  constructor(private deps: RegistryDeps) {
    this.file = path.join(deps.appDir, 'models.json')
    this.dahl = new DahlRouter({ getKey: deps.getKey, getPreferred: deps.getPreferred, onUsage: deps.onUsage, onHealth: deps.onHealth })
  }

  async load(): Promise<CacheFile> {
    if (!this.loaded) {
      this.cache = await readJson<CacheFile>(this.file, { seen: {}, models: [], errors: {} })
      this.cache.errors ??= {}
      this.loaded = true
    }
    return this.cache
  }

  async list(): Promise<{ models: ModelInfo[]; errors: Partial<Record<ProviderId, string>> }> {
    const c = await this.load()
    return { models: c.models, errors: c.errors }
  }

  async find(key: string): Promise<ModelInfo | undefined> {
    return (await this.load()).models.find((m) => m.key === key)
  }

  startAutoRefresh(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.refresh().catch(() => {}), 30 * 60 * 1000)
  }

  async refresh(only?: ProviderId): Promise<{ models: ModelInfo[]; errors: Partial<Record<ProviderId, string>> }> {
    const c = await this.load()
    const firstEver = Object.keys(c.seen).length === 0
    const providers: ProviderId[] = only ? [only] : ['dahl', 'openai', 'anthropic', 'gemini', 'nvidia']
    const now = nowIso()
    let models = c.models.filter((m) => !providers.includes(m.provider))
    for (const p of providers) {
      const key = p === 'dahl' ? null : await this.deps.getKey(PROVIDER_INFO[p].slot)
      if (p !== 'dahl' && !key) {
        delete c.errors[p]
        continue
      }
      try {
        const raw = await fetchProviderModels(p, key)
        for (const r of raw) {
          const k = `${p}:${r.id}`
          const providerSeenBefore = Object.keys(c.seen).some((s) => s.startsWith(`${p}:`))
          if (!c.seen[k]) c.seen[k] = providerSeenBefore && !firstEver ? now : '1970-01-01T00:00:00.000Z'
          const firstSeenAt = c.seen[k]
          models.push({ ...r, key: k, firstSeenAt, isNew: Date.now() - Date.parse(firstSeenAt) < 7 * 86400_000 })
        }
        delete c.errors[p]
      } catch (e) {
        c.errors[p] = (e as Error).message
        models = models.concat(c.models.filter((m) => m.provider === p)) // keep last known list
      }
    }
    c.models = models.sort((a, b) => (a.provider === b.provider ? a.label.localeCompare(b.label) : providerOrder(a.provider) - providerOrder(b.provider)))
    c.fetchedAt = now
    await writeJson(this.file, c)
    this.deps.onModels(c.models)
    return { models: c.models, errors: c.errors }
  }

  /** Test a key with a real authenticated request and return a readable result. */
  async testKey(slot: KeySlot): Promise<KeyTestResult> {
    const key = await this.deps.getKey(slot)
    if (!key) return { slot, ok: false, error: 'No key stored in this slot.' }
    try {
      if (slot === 'primary' || slot === 'secondary') {
        const { status, body } = await getKeyBalance(key)
        const remaining = extractRemaining(body)
        this.deps.onHealth(slot, remaining === 0 ? 'exhausted' : 'ok')
        return {
          slot,
          ok: true,
          httpStatus: status,
          remainingTokens: remaining,
          summary: remaining === null ? 'Key accepted' : remaining === 0 ? 'Key accepted, but it has 0 tokens allocated. Allocate tokens in your Dahl account.' : `${remaining.toLocaleString()} tokens remaining on this key`,
          raw: body
        }
      }
      const provider = slot as ProviderId
      const raw = await fetchProviderModels(provider, key)
      this.deps.onHealth(slot, 'ok')
      void this.refresh(provider).catch(() => {})
      return { slot, ok: true, httpStatus: 200, summary: `${raw.length} chat models available to this key` }
    } catch (e) {
      const err = e as DahlError
      this.deps.onHealth(slot, err.kind === 'auth' ? 'auth_failed' : err.kind === 'exhausted' ? 'exhausted' : 'error', err.message)
      return { slot, ok: false, httpStatus: err.status, error: err.message }
    }
  }

  /** Single entry point for all model calls. Dahl uses two-key failover; other providers use their one key. No cross-provider fallback. */
  async chat(req: ChatRequest & { thinking?: ThinkingLevel }, signal: AbortSignal, cb: StreamCallbacks = {}): Promise<ChatResult & { slot?: string }> {
    const sep = req.model.indexOf(':')
    const provider = (sep > 0 ? req.model.slice(0, sep) : 'dahl') as ProviderId
    const id = sep > 0 ? req.model.slice(sep + 1) : req.model
    const info = await this.find(`${provider}:${id}`)
    const vision = info?.vision ?? false
    const lvl = req.thinking ?? 'off'
    if (provider === 'dahl') return this.dahl.chat({ ...req, model: id, vision: false }, signal, cb)

    const slot = PROVIDER_INFO[provider].slot
    const key = await this.deps.getKey(slot)
    if (!key) throw new DahlError('auth', `No ${PROVIDER_INFO[provider].name} API key configured. Add one in Settings > API Keys.`)

    const extra: Record<string, unknown> = {}
    let maxTokens = Math.min(info?.maxOutputTokens ?? 16000, 64000)
    if (lvl !== 'off' && info?.thinking === 'native') {
      if (provider === 'openai' || provider === 'gemini') extra.reasoning_effort = lvl
      if (provider === 'nvidia') extra.chat_template_kwargs = { enable_thinking: true }
      if (provider === 'anthropic') {
        const types = info.thinkingTypes ?? []
        if (types.includes('adaptive')) {
          extra.thinking = { type: 'adaptive' }
          extra.output_config = { effort: lvl }
        } else {
          const budget = { low: 2048, medium: 8192, high: 24000 }[lvl]
          maxTokens = Math.max(maxTokens, budget + 8000)
          extra.thinking = { type: 'enabled', budget_tokens: budget }
        }
      }
    }

    let lastErr: DahlError | null = null
    let ex = extra
    for (let attempt = 0; attempt < 3; attempt++) {
      const t0 = Date.now()
      let started = false
      const wrapped = { ...cb, onDelta: (t: string) => ((started = true), cb.onDelta?.(t)), onReasoning: (t: string) => ((started = true), cb.onReasoning?.(t)) }
      try {
        const res = await (provider === 'anthropic'
          ? anthropicStream(key, { ...req, model: id, vision, extra: ex, maxTokens }, signal, wrapped)
          : streamChat(key, { ...req, model: id, vision, extra: ex }, signal, wrapped, fetch, { baseUrl: PROVIDER_INFO[provider].base }))
        const reported = typeof res.usage?.prompt_tokens === 'number'
        this.deps.onUsage(slot, {
          ok: true,
          promptTokens: res.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(req.messages).length / 4),
          completionTokens: res.usage?.completion_tokens ?? Math.ceil((res.content + res.reasoning).length / 4),
          estimated: !reported,
          lastModel: req.model,
          lastLatencyMs: Date.now() - t0
        })
        this.deps.onHealth(slot, 'ok')
        return { ...res, slot }
      } catch (e) {
        const err = e instanceof DahlError ? e : new DahlError('network', String(e))
        if (err.kind === 'cancelled' || started) throw err
        lastErr = err
        this.deps.onUsage(slot, { ok: false, lastModel: req.model, lastLatencyMs: Date.now() - t0 })
        // A model that rejects a reasoning parameter: retry once without it.
        if (err.kind === 'bad_request' && Object.keys(ex).length) {
          ex = {}
          continue
        }
        if (['server', 'timeout', 'network', 'rate_model'].includes(err.kind) && attempt < 2) {
          await new Promise((r) => setTimeout(r, Math.min(err.retryAfterMs ?? 1000 * 2 ** attempt, 10000)))
          continue
        }
        if (['auth', 'exhausted', 'rate_key'].includes(err.kind)) this.deps.onHealth(slot, err.kind === 'auth' ? 'auth_failed' : err.kind === 'exhausted' ? 'exhausted' : 'rate_limited', err.message)
        if (err.kind === 'model_unavailable') {
          // retired for this key: drop it from the catalogue so it is not offered again
          this.cache.models = this.cache.models.filter((m) => m.key !== req.model)
          await writeJson(this.file, this.cache).catch(() => {})
          this.deps.onModels(this.cache.models)
          err.message = `${PROVIDER_INFO[provider].name} says ${id} is not available to your key (removed from the list). Pick another model. Details: ${err.message.slice(0, 300)}`
        }
        if (provider === 'gemini' && err.kind === 'exhausted' && /limit: 0|free_tier/i.test(err.message))
          err.message = `Your Gemini free tier has no quota for ${id} (Google sets the limit to 0 for this model). Choose a Gemini Flash model or enable billing in Google AI Studio.`
        throw err
      }
    }
    throw lastErr ?? new DahlError('network', 'Request failed')
  }
}

function providerOrder(p: ProviderId): number {
  return ['dahl', 'openai', 'anthropic', 'gemini', 'nvidia'].indexOf(p)
}
