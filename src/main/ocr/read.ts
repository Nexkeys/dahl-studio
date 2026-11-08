import { createHash } from 'node:crypto'
import { formatBreakdown, imageFacts, readingText } from './breakdown'
import { buildLayout } from './layout'
import { ocrImage, type OcrEngineFns } from './pipeline'
import { isDark, rgbPixels } from './preprocess'

/** One image read end to end (OCR, layout, breakdown), cached by content hash. */
export interface ImageRead {
  /** the breakdown for a model that cannot see the image */
  body: string
  /** plain recognised text in reading order (unclear regions marked), sent along with the image to vision models */
  text: string
  ok: boolean
  ms: number
}

const CACHE_MAX = 64
const cache = new Map<string, ImageRead>()
const inflight = new Map<string, Promise<ImageRead>>()

export const contentHash = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

export interface ReadOptions {
  signal?: AbortSignal
  /** another OCR engine (the accurate one) with its display name; Windows OCR otherwise */
  engine?: { fns: OcrEngineFns; name: string; id: string }
  /** a note shown under the breakdown (for example why the accurate engine was not used) */
  note?: string
}

export async function readImage(data: Buffer, o: ReadOptions = {}): Promise<ImageRead> {
  const key = `${o.engine?.id ?? 'windows'}:${contentHash(data)}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit) // most recently used last
    return hit
  }
  const running = inflight.get(key)
  if (running) return running
  const p = readUncached(data, o).finally(() => inflight.delete(key))
  inflight.set(key, p)
  const res = await p
  if (res.ok) {
    cache.set(key, res)
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  }
  return res
}

async function readUncached(data: Buffer, o: ReadOptions): Promise<ImageRead> {
  const t0 = Date.now()
  try {
    const out = await ocrImage(data, { engine: o.engine?.fns, signal: o.signal })
    const layout = buildLayout(out)
    const facts = imageFacts(out.px, out.width, out.height, out.inverted)
    const body = formatBreakdown(facts, out, layout, o.engine?.name) + (o.note ? `\n${o.note}` : '')
    return { body, text: readingText(layout), ok: true, ms: Date.now() - t0 }
  } catch (e) {
    if (o.signal?.aborted) throw e
    // OCR failed (no language pack, not Windows, helper stuck): still describe size and colours
    try {
      const px = await rgbPixels(data, 1200)
      const facts = imageFacts(px, px.width / px.scale, px.height / px.scale, isDark(px))
      return { body: formatBreakdown(facts, (e as Error).message, null), text: '', ok: false, ms: Date.now() - t0 }
    } catch (e2) {
      return { body: `The image could not be decoded (${(e2 as Error).message}).`, text: '', ok: false, ms: Date.now() - t0 }
    }
  }
}

/** Test hook: forget cached readings. */
export function clearImageCache(): void {
  cache.clear()
}
