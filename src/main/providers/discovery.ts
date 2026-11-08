import type { ModelInfo } from '@shared/types'
import { classifyHttpError, DahlError, type FetchLike } from '../dahl/client'

/**
 * Live model discovery for Groq, OpenRouter, Ollama and LM Studio. Each parser turns the provider's own listing into
 * one capability record per model (tools, vision, reasoning, context length, free, local) on ModelInfo.
 */
export type RawModel = Omit<ModelInfo, 'key' | 'firstSeenAt' | 'isNew'>

export const NON_CHAT = /(embed|embedding|tts|whisper|dall-e|davinci|babbage|audio|realtime|moderation|transcribe|image-|imagen|aqa|rerank|reward|guard|safety|clip|nemoretriever|parse|retriever|veo|lyria|sora|search-preview|computer-use|-detector)/i

export async function getJson(url: string, headers: Record<string, string>, fetchImpl: FetchLike = fetch, timeoutMs = 20000, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  let res: Response
  try {
    res = await fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw new DahlError('network', `Could not reach ${new URL(url).host}: ${(e as Error).message}`)
  }
  const text = await res.text()
  if (!res.ok) throw classifyHttpError(res.status, text, res.headers.get('retry-after'))
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    throw new DahlError('bad_request', `${new URL(url).host} returned something that is not JSON`)
  }
}

// ---------------- Groq ----------------
export const GROQ_BASE = 'https://api.groq.com/openai/v1'
const GROQ_SKIP = /(orpheus|playai|whisper|tts|guard)/i
// Groq's /models has no capability fields, so these follow its model pages (https://console.groq.com/docs/models)
const GROQ_REASONING = /(gpt-oss|qwen3|qwq|deepseek-r1|r1-distill|kimi-k2-thinking|magistral)/i
const GROQ_NO_TOOLS = /(compound|allam|saba|gemma)/i

/** GET /models: { data: [{ id, active, context_window, max_completion_tokens }] }. Inactive models are left out. */
export function parseGroqModels(body: any): RawModel[] {
  return (Array.isArray(body?.data) ? body.data : [])
    .filter((m: any) => m?.id && m.active !== false && !GROQ_SKIP.test(m.id) && !NON_CHAT.test(m.id))
    .map((m: any): RawModel => {
      const id = String(m.id)
      const reasoning = GROQ_REASONING.test(id)
      return {
        provider: 'groq', id, label: id,
        vision: /(llama-4|vision|maverick|scout)/i.test(id),
        tools: !GROQ_NO_TOOLS.test(id),
        reasoning,
        // gpt-oss and qwen3 take reasoning_effort; other reasoning models think on their own
        thinking: /(gpt-oss|qwen3)/i.test(id) ? 'native' : 'app',
        contextTokens: num(m.context_window),
        maxOutputTokens: num(m.max_completion_tokens),
        free: false, local: false
      }
    })
}

// ---------------- OpenRouter ----------------
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

/** GET /models: architecture.input_modalities, supported_parameters, context_length, pricing, top_provider. */
export function parseOpenRouterModels(body: any): RawModel[] {
  const out: RawModel[] = []
  for (const m of Array.isArray(body?.data) ? body.data : []) {
    if (!m?.id) continue
    const arch = m.architecture ?? {}
    const outputs: string[] | undefined = arch.output_modalities ?? (typeof arch.modality === 'string' ? arch.modality.split('->')[1]?.split('+') : undefined)
    if (outputs && !outputs.includes('text')) continue
    const inputs: string[] = arch.input_modalities ?? (typeof arch.modality === 'string' ? arch.modality.split('->')[0].split('+') : ['text'])
    const params: string[] = Array.isArray(m.supported_parameters) ? m.supported_parameters : []
    const prompt = Number(m.pricing?.prompt)
    const completion = Number(m.pricing?.completion)
    const reasoning = params.includes('reasoning') || params.includes('include_reasoning')
    const id = String(m.id)
    out.push({
      provider: 'openrouter', id, label: typeof m.name === 'string' && m.name ? m.name : id,
      vision: inputs.includes('image'),
      tools: params.includes('tools'),
      reasoning,
      thinking: params.includes('reasoning') ? 'native' : 'app',
      contextTokens: num(m.context_length) ?? num(m.top_provider?.context_length),
      maxOutputTokens: num(m.top_provider?.max_completion_tokens),
      free: id.endsWith(':free') || (prompt === 0 && completion === 0),
      local: false
    })
  }
  return out
}

// ---------------- Ollama ----------------
/** One model from GET /api/tags plus its POST /api/show (capabilities: completion, tools, vision, thinking, embedding). */
export function parseOllamaModel(tag: any, show: any | null): RawModel | null {
  const name = String(tag?.name ?? tag?.model ?? '')
  if (!name) return null
  const caps: string[] = Array.isArray(show?.capabilities) ? show.capabilities : []
  if (caps.length && !caps.includes('completion')) return null // embedding-only
  if (!caps.length && /embed/i.test(name)) return null
  let ctx: number | undefined
  for (const [k, v] of Object.entries(show?.model_info ?? {})) if (k.endsWith('.context_length') && typeof v === 'number') ctx = v
  const reasoning = caps.includes('thinking')
  const size = tag?.details?.parameter_size
  return {
    provider: 'ollama', id: name, label: `${name.replace(/:latest$/, '')}${size ? ` (${size})` : ''}`,
    vision: caps.includes('vision'),
    tools: caps.includes('tools'),
    reasoning,
    thinking: reasoning ? 'native' : 'app',
    contextTokens: ctx,
    free: false, local: true
  }
}

export async function fetchOllamaModels(base: string, fetchImpl: FetchLike = fetch): Promise<RawModel[]> {
  const { body } = await getJson(`${base}/api/tags`, {}, fetchImpl, 4000)
  const tags: any[] = Array.isArray(body?.models) ? body.models : []
  const out: (RawModel | null)[] = new Array(tags.length).fill(null)
  // /api/show per model for capabilities and context length, four at a time
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < tags.length) {
      const i = next++
      const show = await getJson(`${base}/api/show`, { 'Content-Type': 'application/json' }, fetchImpl, 8000, { method: 'POST', body: JSON.stringify({ model: tags[i].name ?? tags[i].model }) })
        .then((r) => r.body)
        .catch(() => null)
      out[i] = parseOllamaModel(tags[i], show)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return out.filter((m): m is RawModel => !!m)
}

// ---------------- LM Studio ----------------
/** Agent prompts are often 10k+ tokens; a model loaded with less context silently loses the start of the prompt. */
export const LMSTUDIO_MIN_CONTEXT = 16384

/**
 * GET /api/v1/models (LM Studio's own REST API): models[] with key, display_name, type, capabilities
 * { trained_for_tool_use, vision, reasoning } and loaded_instances[].config.context_length. Older servers answer
 * /api/v0/models-style entries (capabilities: ["tool_use"], type "vlm", loaded_context_length); both are read.
 */
export function parseLmStudioModels(body: any): { models: RawModel[]; smallContext?: number } {
  const items: any[] = Array.isArray(body?.models) ? body.models : Array.isArray(body?.data) ? body.data : []
  const models: RawModel[] = []
  let smallContext: number | undefined
  for (const m of items) {
    const id = String(m?.key ?? m?.id ?? m?.modelKey ?? '')
    if (!id || (m.type && !['llm', 'vlm'].includes(m.type)) || /embed/i.test(m.type ?? '')) continue
    const caps = m.capabilities
    const list: string[] = Array.isArray(caps) ? caps : []
    const obj = caps && !Array.isArray(caps) && typeof caps === 'object' ? caps : {}
    const loaded = num(m.loaded_instances?.[0]?.config?.context_length) ?? num(m.loaded_context_length)
    if (loaded && loaded < LMSTUDIO_MIN_CONTEXT) smallContext = Math.min(smallContext ?? loaded, loaded)
    const reasoning = !!obj.reasoning || list.includes('reasoning')
    models.push({
      provider: 'lmstudio', id, label: typeof m.display_name === 'string' && m.display_name ? m.display_name : id,
      vision: !!obj.vision || m.type === 'vlm' || list.includes('vision'),
      tools: !!obj.trained_for_tool_use || list.includes('tool_use'),
      reasoning,
      thinking: 'app',
      contextTokens: loaded ?? num(m.max_context_length),
      free: false, local: true
    })
  }
  return { models, smallContext }
}

/** /api/v1/models first; a server without it (older LM Studio) falls back to the OpenAI-compatible /v1/models. */
export async function fetchLmStudioModels(base: string, fetchImpl: FetchLike = fetch): Promise<{ models: RawModel[]; smallContext?: number }> {
  try {
    const { body } = await getJson(`${base}/api/v1/models`, {}, fetchImpl, 5000)
    const r = parseLmStudioModels(body)
    if (r.models.length || Array.isArray(body?.models)) return r
  } catch (e) {
    if ((e as DahlError).kind === 'network' || (e as DahlError).kind === 'timeout') throw e
  }
  const { body } = await getJson(`${base}/v1/models`, {}, fetchImpl, 5000)
  return {
    models: (Array.isArray(body?.data) ? body.data : [])
      .map((m: any) => String(m?.id ?? ''))
      .filter((id: string) => id && !/embed/i.test(id))
      .map((id: string): RawModel => ({ provider: 'lmstudio', id, label: id, vision: false, tools: false, reasoning: false, thinking: 'app', free: false, local: true }))
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}
