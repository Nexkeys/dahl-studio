import path from 'node:path'
import type { KeySlot, KeyTestResult, KeyUsageLocal, LocalProviderId, LocalProviderStatus, ModelInfo, ProviderId, ThinkingLevel } from '@shared/types'
import { isLocalProvider, LOCAL_DEFAULT_URL, LOCAL_PROVIDERS, PROVIDER_ORDER, splitModelKey } from '@shared/models'
import { DAHL_DOCUMENTED_CONTEXT, DahlError, extractRemaining, getKeyBalance, listModels as listDahlModels, streamChat, type ChatRequest, type ChatResult, type FetchLike, type StreamCallbacks } from '../dahl/client'
import { DahlRouter } from '../dahl/router'
import { ANTHROPIC_BASE, anthropicHeaders, anthropicStream } from './anthropic'
import { fetchLmStudioModels, fetchOllamaModels, getJson as getJsonWith, GROQ_BASE, NON_CHAT, OPENROUTER_BASE, parseGroqModels, parseOpenRouterModels, type RawModel } from './discovery'
import { extractContentToolCalls, OPENROUTER_HEADERS, shapeGroq, shapeOpenRouter } from './quirks'
import { ollamaNumCtx, ollamaStream } from './ollama'
import { nowIso, readJson, writeJson } from '../util'

/** Providers that need an API key (Ollama and LM Studio run on this PC, see LOCAL_PROVIDERS). */
export type KeyedProvider = Exclude<ProviderId, LocalProviderId>

export const PROVIDER_INFO: Record<KeyedProvider, { name: string; base: string; slot: KeySlot; docs: string }> = {
  dahl: { name: 'Dahl', base: 'https://inference.dahl.global/v1', slot: 'primary', docs: 'Dahl-Studio-Product-Pack/docs/Dahl_API_DOCS.md' },
  openai: { name: 'OpenAI', base: 'https://api.openai.com/v1', slot: 'openai', docs: 'https://platform.openai.com/docs/api-reference/chat' },
  anthropic: { name: 'Anthropic', base: ANTHROPIC_BASE, slot: 'anthropic', docs: 'https://docs.anthropic.com/en/api/messages' },
  gemini: { name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', slot: 'gemini', docs: 'https://ai.google.dev/gemini-api/docs/openai' },
  nvidia: { name: 'NVIDIA', base: 'https://integrate.api.nvidia.com/v1', slot: 'nvidia', docs: 'https://docs.api.nvidia.com/nim/reference' },
  groq: { name: 'Groq', base: GROQ_BASE, slot: 'groq', docs: 'https://console.groq.com/docs/openai' },
  openrouter: { name: 'OpenRouter', base: OPENROUTER_BASE, slot: 'openrouter', docs: 'https://openrouter.ai/docs/api-reference/overview' }
}
export const LOCAL_INFO: Record<LocalProviderId, { name: string; docs: string }> = {
  ollama: { name: 'Ollama', docs: 'https://github.com/ollama/ollama/blob/main/docs/api.md' },
  lmstudio: { name: 'LM Studio', docs: 'https://lmstudio.ai/docs/app/api' }
}
const providerName = (p: ProviderId): string => (isLocalProvider(p) ? LOCAL_INFO[p].name : PROVIDER_INFO[p].name)

function oaVision(id: string): boolean {
  return /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4\.5|gpt-5|gpt-6|chatgpt-4o|^o1(?!-mini)|^o3(?!-mini)|^o4)/i.test(id)
}
function oaThinking(id: string): boolean {
  return /(^o\d|gpt-5|gpt-6)/i.test(id)
}

/**
 * Fetch the live model list for a provider. Returns only chat-capable models, each with its capability record
 * (tools, vision, reasoning, context, free, local). `base` is the server URL for local providers.
 */
export async function fetchProviderModels(provider: ProviderId, key: string | null, fetchImpl: FetchLike = fetch, base?: string): Promise<RawModel[]> {
  const caps = (list: RawModel[], tools: (m: RawModel) => boolean | undefined): RawModel[] =>
    list.map((m) => ({ ...m, tools: m.tools ?? tools(m), reasoning: m.reasoning ?? m.thinking === 'native', free: m.free ?? false, local: m.local ?? false }))
  const getJson = (url: string, headers: Record<string, string>) => getJsonWith(url, headers, fetchImpl)
  switch (provider) {
    case 'groq':
      return parseGroqModels((await getJson(`${GROQ_BASE}/models`, { Authorization: `Bearer ${key}` })).body)
    case 'openrouter':
      return parseOpenRouterModels((await getJson(`${OPENROUTER_BASE}/models`, { Authorization: `Bearer ${key}`, ...OPENROUTER_HEADERS })).body)
    case 'ollama':
      return fetchOllamaModels(base ?? LOCAL_DEFAULT_URL.ollama, fetchImpl)
    case 'lmstudio':
      return (await fetchLmStudioModels(base ?? LOCAL_DEFAULT_URL.lmstudio, fetchImpl)).models
    default:
      // Dahl: every listed model is a chat model used with tools by the agent; NVIDIA's catalogue does not say
      return caps(await fetchCloudModels(provider, key, getJson, fetchImpl), (m) => (m.provider === 'nvidia' ? undefined : !/gemma/i.test(m.id)))
  }
}

async function fetchCloudModels(provider: ProviderId, key: string | null, getJson: (url: string, headers: Record<string, string>) => Promise<{ body: any }>, fetchImpl: FetchLike): Promise<RawModel[]> {
  switch (provider) {
    case 'dahl':
      return (await listDahlModels(fetchImpl)).map((m) => ({ provider, id: m.id, label: m.id, vision: false, thinking: 'app' as const, contextTokens: DAHL_DOCUMENTED_CONTEXT[m.id] }))
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
    default:
      return []
  }
}

export interface RegistryDeps {
  appDir: string
  getKey(slot: KeySlot): Promise<string | null>
  getPreferred(): Promise<'primary' | 'secondary'>
  onUsage(slot: KeySlot, u: Partial<KeyUsageLocal> & { ok: boolean }): void
  onHealth(slot: KeySlot, h: 'ok' | 'auth_failed' | 'exhausted' | 'rate_limited' | 'error', err?: string): void
  onModels(models: ModelInfo[]): void
  /** base URL of a local model server from settings (default LOCAL_DEFAULT_URL) */
  getLocalBase?(p: LocalProviderId): Promise<string>
  /** tests pass a fake fetch; the app uses the global one */
  fetchImpl?: FetchLike
}

interface CacheFile {
  seen: Record<string, string>
  models: ModelInfo[]
  errors: Partial<Record<ProviderId, string>>
  fetchedAt?: string
  /** last check of each local model server */
  local?: Partial<Record<LocalProviderId, LocalProviderStatus>>
}

export interface ModelListing {
  models: ModelInfo[]
  errors: Partial<Record<ProviderId, string>>
  local: LocalProviderStatus[]
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

  private get fetch(): FetchLike {
    return this.deps.fetchImpl ?? fetch
  }

  async localBase(p: LocalProviderId): Promise<string> {
    return (await this.deps.getLocalBase?.(p)) || LOCAL_DEFAULT_URL[p]
  }

  async list(): Promise<ModelListing> {
    const c = await this.load()
    return { models: c.models, errors: c.errors, local: LOCAL_PROVIDERS.map((p) => c.local?.[p]).filter((s): s is LocalProviderStatus => !!s) }
  }

  async find(key: string): Promise<ModelInfo | undefined> {
    return (await this.load()).models.find((m) => m.key === key)
  }

  startAutoRefresh(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.refresh().catch(() => {}), 30 * 60 * 1000)
  }

  private queue: Promise<unknown> = Promise.resolve()

  /**
   * Re-list models from every provider (or only the given ones). The list for a provider is replaced by what it lists
   * now, so a model it no longer offers disappears; a provider without a key, or a local server that is not running,
   * offers nothing. Only an error (provider down, rate limited) keeps the last known list. Calls run one at a time.
   */
  refresh(only?: ProviderId | ProviderId[]): Promise<ModelListing> {
    const run = this.queue.then(() => this.doRefresh(only === undefined ? PROVIDER_ORDER : Array.isArray(only) ? only : [only]))
    this.queue = run.catch(() => {})
    return run
  }

  private async doRefresh(providers: ProviderId[]): Promise<ModelListing> {
    const c = await this.load()
    const firstEver = Object.keys(c.seen).length === 0
    const now = nowIso()
    const results = await Promise.all(providers.map((p) => this.discover(p, now)))
    let models = c.models.filter((m) => !providers.includes(m.provider))
    for (const { p, raw, error, local } of results) {
      if (local) (c.local ??= {})[local.provider] = local
      if (!raw) {
        c.errors[p] = error ?? 'Model list unavailable'
        models = models.concat(c.models.filter((m) => m.provider === p)) // keep last known list
        continue
      }
      delete c.errors[p]
      // the first listing of a provider (a key just added) is not "new"; models it adds later are
      const providerSeenBefore = Object.keys(c.seen).some((s) => s.startsWith(`${p}:`))
      const keys = new Set<string>()
      for (const r of raw) {
        const k = `${p}:${r.id}`
        if (keys.has(k)) continue
        keys.add(k)
        if (!c.seen[k]) c.seen[k] = providerSeenBefore && !firstEver ? now : '1970-01-01T00:00:00.000Z'
        const firstSeenAt = c.seen[k]
        models.push({ ...r, key: k, firstSeenAt, isNew: Date.now() - Date.parse(firstSeenAt) < 7 * 86400_000 })
      }
    }
    c.models = models.sort((a, b) => (a.provider === b.provider ? a.label.localeCompare(b.label) : providerOrder(a.provider) - providerOrder(b.provider)))
    c.fetchedAt = now
    await writeJson(this.file, c)
    this.deps.onModels(c.models)
    return this.list()
  }

  /** raw: the provider's models now ([] = offers none), or null when the listing failed and the old list stays. */
  private async discover(p: ProviderId, now: string): Promise<{ p: ProviderId; raw: RawModel[] | null; error?: string; local?: LocalProviderStatus }> {
    if (isLocalProvider(p)) {
      const baseUrl = await this.localBase(p)
      try {
        const r = p === 'ollama' ? { models: await fetchOllamaModels(baseUrl, this.fetch), smallContext: undefined } : await fetchLmStudioModels(baseUrl, this.fetch)
        return { p, raw: r.models, local: { provider: p, baseUrl, running: true, models: r.models.length, checkedAt: now, smallContext: r.smallContext } }
      } catch (e) {
        // not running is normal (most people have neither): its models go away, and it is not shown as an error
        const down = ['network', 'timeout'].includes((e as DahlError).kind)
        const error = (e as Error).message
        return { p, raw: down ? [] : null, error, local: { provider: p, baseUrl, running: !down, models: 0, checkedAt: now, error: down ? undefined : error } }
      }
    }
    const key = p === 'dahl' ? null : await this.deps.getKey(PROVIDER_INFO[p].slot)
    if (p !== 'dahl' && !key) return { p, raw: [] }
    try {
      return { p, raw: await fetchProviderModels(p, key, this.fetch) }
    } catch (e) {
      return { p, raw: null, error: (e as Error).message }
    }
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
      const provider = slot as KeyedProvider
      // OpenRouter lists its models without a key, so the key itself is checked first
      const credit = provider === 'openrouter' ? await openRouterKeyInfo(key, this.fetch) : ''
      const raw = await fetchProviderModels(provider, key, this.fetch)
      this.deps.onHealth(slot, 'ok')
      void this.refresh(provider).catch(() => {})
      return { slot, ok: true, httpStatus: 200, summary: `${credit}${raw.length} chat models available to this key` }
    } catch (e) {
      const err = e as DahlError
      this.deps.onHealth(slot, err.kind === 'auth' ? 'auth_failed' : err.kind === 'exhausted' ? 'exhausted' : 'error', err.message)
      return { slot, ok: false, httpStatus: err.status, error: err.message }
    }
  }

  /** Single entry point for all model calls. Dahl uses two-key failover; other providers use their one key (local ones none). No cross-provider fallback. */
  async chat(req: ChatRequest & { thinking?: ThinkingLevel }, signal: AbortSignal, cb: StreamCallbacks = {}): Promise<ChatResult & { slot?: string }> {
    const { provider, id } = splitModelKey(req.model)
    const info = await this.find(`${provider}:${id}`)
    const vision = info?.vision ?? false
    const lvl = req.thinking ?? 'off'
    if (provider === 'dahl') return this.dahl.chat({ ...req, model: id, vision: false }, signal, cb)

    const local = isLocalProvider(provider)
    const slot = local ? undefined : PROVIDER_INFO[provider].slot
    const key = slot ? await this.deps.getKey(slot) : null
    if (slot && !key) throw new DahlError('auth', `No ${providerName(provider)} API key configured. Add one in Settings > API Keys.`)
    const base = local ? await this.localBase(provider) : undefined

    const extra: Record<string, unknown> = {}
    let maxTokens = Math.min(info?.maxOutputTokens ?? 16000, 64000)
    if (lvl !== 'off' && info?.thinking === 'native') {
      if (provider === 'openai' || provider === 'gemini') extra.reasoning_effort = lvl
      if (provider === 'nvidia') extra.chat_template_kwargs = { enable_thinking: true }
      if (provider === 'groq') extra.reasoning_effort = /qwen3/i.test(id) ? 'default' : lvl
      if (provider === 'openrouter') extra.reasoning = { effort: lvl }
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
    // Ollama: think for models with the thinking capability (gpt-oss takes a level and cannot switch it off)
    if (provider === 'ollama' && info?.reasoning) extra.think = /gpt-oss/i.test(id) ? (lvl === 'off' ? 'low' : lvl) : lvl !== 'off'

    let lastErr: DahlError | null = null
    let ex = extra
    let toolRetried = false
    let nativeTools = info?.tools ?? true
    for (let attempt = 0; attempt < 3; attempt++) {
      const t0 = Date.now()
      let started = false
      const wrapped = { ...cb, onDelta: (t: string) => ((started = true), cb.onDelta?.(t)), onReasoning: (t: string) => ((started = true), cb.onReasoning?.(t)) }
      try {
        const res = await this.send(provider, id, key, base, { ...req, model: id, vision, extra: ex }, { maxTokens, nativeTools, numCtx: ollamaNumCtx(info?.contextTokens) }, signal, wrapped)
        if (slot) {
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
        }
        return { ...res, slot }
      } catch (e) {
        const err = e instanceof DahlError ? e : new DahlError('network', String(e))
        if (err.kind === 'cancelled' || started) throw err
        lastErr = err
        if (slot) this.deps.onUsage(slot, { ok: false, lastModel: req.model, lastLatencyMs: Date.now() - t0, lastError: `${err.kind}: ${err.message}`.slice(0, 300) })
        // Groq answers 400 tool_use_failed when the model wrote a malformed tool call; a second try usually works
        if (provider === 'groq' && err.code === 'tool_use_failed' && !toolRetried) {
          toolRetried = true
          continue
        }
        // a local model without the tools capability: describe the tools in the prompt instead
        if (provider === 'ollama' && nativeTools && err.kind === 'bad_request' && /does not support tools/i.test(err.message)) {
          nativeTools = false
          continue
        }
        if (provider === 'openrouter' && /no endpoints found/i.test(err.message)) {
          err.kind = 'bad_request'
          err.message = `No OpenRouter provider serves ${id} with everything this request needs (tool calling${vision ? ', images' : ''}). Pick a model with the tools badge. Details: ${err.message.slice(0, 200)}`
          throw err
        }
        // A model that rejects a reasoning parameter: retry once without it.
        if (err.kind === 'bad_request' && Object.keys(ex).length) {
          ex = {}
          continue
        }
        if (['server', 'timeout', 'network', 'rate_model'].includes(err.kind) && attempt < 2) {
          await new Promise((r) => setTimeout(r, Math.min(err.retryAfterMs ?? 1000 * 2 ** attempt, 10000)))
          continue
        }
        if (slot && ['auth', 'exhausted', 'rate_key'].includes(err.kind)) this.deps.onHealth(slot, err.kind === 'auth' ? 'auth_failed' : err.kind === 'exhausted' ? 'exhausted' : 'rate_limited', err.message)
        if (err.kind === 'model_unavailable') {
          // retired for this key: drop it from the catalogue so it is not offered again
          this.cache.models = this.cache.models.filter((m) => m.key !== req.model)
          await writeJson(this.file, this.cache).catch(() => {})
          this.deps.onModels(this.cache.models)
          err.message = `${providerName(provider)} says ${id} is not available${local ? '' : ' to your key'} (removed from the list). Pick another model. Details: ${err.message.slice(0, 300)}`
        }
        if (local && err.kind === 'network' && /could not reach|fetch failed|econnrefused|connect/i.test(err.message)) err.message = `${providerName(provider)} is not running at ${base} (or cannot be reached). Start it, or change its address in Settings > Local models.`
        if (provider === 'gemini' && err.kind === 'exhausted' && /limit: 0|free_tier/i.test(err.message))
          err.message = `Your Gemini free tier has no quota for ${id} (Google sets the limit to 0 for this model). Choose a Gemini Flash model or enable billing in Google AI Studio.`
        throw err
      }
    }
    throw lastErr ?? new DahlError('network', 'Request failed')
  }

  /** One request to a non-Dahl provider, with that provider's adapter and quirks. */
  private async send(
    provider: Exclude<ProviderId, 'dahl'>, id: string, key: string | null, base: string | undefined, req: ChatRequest,
    o: { maxTokens: number; nativeTools: boolean; numCtx: number }, signal: AbortSignal, cb: StreamCallbacks
  ): Promise<ChatResult> {
    switch (provider) {
      case 'anthropic':
        return anthropicStream(key!, { ...req, maxTokens: o.maxTokens }, signal, cb, this.fetch)
      case 'ollama': {
        const { think, ...rest } = req.extra ?? {}
        return ollamaStream({ ...req, extra: rest, baseUrl: base!, numCtx: o.numCtx, nativeTools: o.nativeTools, think: think as boolean | string | undefined }, signal, cb, this.fetch)
      }
      case 'lmstudio': {
        // LM Studio parses tool calls for most models; ones it cannot parse arrive as text in the reply
        const res = await streamChat(key ?? 'lm-studio', req, signal, cb, this.fetch, { baseUrl: `${base}/v1` })
        if (!res.toolCalls.length && req.tools?.length) {
          const parsed = extractContentToolCalls(res.content, req.tools)
          if (parsed.toolCalls.length) return { ...res, content: parsed.content, toolCalls: parsed.toolCalls, finishReason: 'tool_calls' }
        }
        return res
      }
      case 'openrouter':
        return streamChat(key!, req, signal, cb, this.fetch, { baseUrl: OPENROUTER_BASE, headers: OPENROUTER_HEADERS, shape: shapeOpenRouter })
      case 'groq':
        return streamChat(key!, req, signal, cb, this.fetch, { baseUrl: GROQ_BASE, shape: shapeGroq(id) })
      default:
        return streamChat(key!, req, signal, cb, this.fetch, { baseUrl: PROVIDER_INFO[provider].base })
    }
  }
}

/** GET /key: checks an OpenRouter key and reads its credit (the models list is public, so it proves nothing). */
async function openRouterKeyInfo(key: string, fetchImpl: FetchLike): Promise<string> {
  const headers = { Authorization: `Bearer ${key}`, ...OPENROUTER_HEADERS }
  const r = await getJsonWith(`${OPENROUTER_BASE}/key`, headers, fetchImpl).catch((e: DahlError) => {
    if (e.status === 404) return getJsonWith(`${OPENROUTER_BASE}/auth/key`, headers, fetchImpl)
    throw e
  })
  const d = r.body?.data ?? {}
  const left = typeof d.limit_remaining === 'number' ? `, $${d.limit_remaining.toFixed(2)} credit left` : ''
  return `Key accepted${d.is_free_tier ? ' (free tier)' : ''}${left}. `
}

function providerOrder(p: ProviderId): number {
  return PROVIDER_ORDER.indexOf(p)
}
