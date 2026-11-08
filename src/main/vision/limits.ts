/**
 * Vision routing rules per provider: how many images one request may carry, how large each image should be, and
 * which of the user's models to prefer for describing images. Providers are plain id strings, so providers added
 * later (groq, openrouter) work without a type change; a provider without a configured key is never used.
 */

export interface VisionModel {
  key: string
  provider: string
  id: string
  label: string
}

/** Images per request. Groq documents a maximum of 5 per request; NVIDIA NIM vision models take one. */
export function imagesPerRequest(provider: string, id: string): number {
  switch (provider) {
    case 'gemini':
      return 16
    case 'anthropic':
      return 20
    case 'openai':
      return 10
    case 'groq':
      return /llama-4/i.test(id) ? 5 : 3
    case 'openrouter':
      return /:free$/i.test(id) ? 4 : 8
    case 'nvidia':
      return 1
    default:
      return 1
  }
}

/** Longest side to send, in px: Anthropic downsizes above 1568; free and NVIDIA endpoints have small payload caps. */
export function maxImageSide(provider: string): number {
  return ({ anthropic: 1568, openai: 2048, gemini: 3072, groq: 1600, openrouter: 1600, nvidia: 1024 } as Record<string, number>)[provider] ?? 1600
}

/** Preferred vision model per provider, best value first (free or cheap and fast before premium). */
export const PREFERRED_VISION: [string, RegExp, RegExp?][] = [
  ['gemini', /gemini-[\d.]+-flash/i, /(image|tts|live|lite-preview|thinking-exp|audio)/i],
  ['groq', /llama-4-(scout|maverick)/i],
  ['openrouter', /:free$/i],
  ['anthropic', /claude-(sonnet|opus|haiku)/i],
  ['openai', /^(gpt-4o|gpt-4\.1|gpt-5)/i, /(mini-tts|audio|realtime|search|transcribe)/i],
  ['nvidia', /(llama-4|llama-3\.2-\d+b-vision|phi-4-multimodal|gemma-3)/i, /fuyu|kosmos|neva|vila/i]
]

/**
 * Up to `max` vision models to try: the selected model first when it can see images, then the preferred model of
 * each provider the user has a working key for. `usable(provider)` must be false for providers without a key.
 */
export function pickVisionModels(models: (VisionModel & { vision: boolean })[], selected: string | null, usable: (provider: string) => boolean, failed: Set<string>, max = 2): VisionModel[] {
  const list = models.filter((m) => m.vision && !failed.has(m.key) && usable(m.provider))
  const out: VisionModel[] = []
  const sel = list.find((m) => m.key === selected)
  if (sel) out.push(sel)
  for (const [p, good, bad] of PREFERRED_VISION) {
    const m = list.filter((x) => x.provider === p && good.test(x.id) && !(bad && bad.test(x.id))).sort((a, b) => b.id.localeCompare(a.id))[0]
    if (m && !out.some((o) => o.key === m.key)) out.push(m)
  }
  return out.slice(0, max)
}

/** Split items into batches of at most `per`. */
export function batches<T>(items: T[], per: number): T[][] {
  const n = Math.max(1, per)
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

/**
 * Split a reply that describes several images ("### Image 2" headings, as the prompt asks) into one text per image.
 * When the model ignored the headings, a single-image batch still gets the whole reply.
 */
export function splitDescriptions(reply: string, count: number): (string | null)[] {
  const out: (string | null)[] = new Array(count).fill(null)
  const re = /^\s*#{1,4}\s*Image\s+(\d+)\b[^\n]*$/gim
  const marks = [...reply.matchAll(re)]
  if (!marks.length) {
    if (count === 1 && reply.trim()) out[0] = reply.trim()
    return out
  }
  marks.forEach((m, i) => {
    const k = Number(m[1]) - 1
    const end = i + 1 < marks.length ? marks[i + 1].index : reply.length
    const text = reply.slice(m.index! + m[0].length, end).trim()
    if (k >= 0 && k < count && text) out[k] = text
  })
  return out
}
