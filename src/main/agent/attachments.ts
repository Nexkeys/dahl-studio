import type { Attachment } from '@shared/types'
import { isPdfAttachment, MAX_IMAGES_PER_MESSAGE } from '@shared/imageLimits'
import type { AttachmentReading } from './history'
import type { Description, DescribeImage } from '../vision/describe'

/**
 * Read attached images and PDFs before the first model call, so the model always has their content (models that
 * cannot see images rarely called analyze_image on their own). Images are read in parallel (cached by content hash
 * in ocr/read.ts). A vision model gets up to its provider's per-request limit as images; images over that limit, and
 * every image for a text-only model, can also be described by one of the user's vision models.
 */

export interface AttachmentDeps {
  readImage(data: Buffer, signal: AbortSignal): Promise<{ body: string; text: string; ok: boolean }>
  readPdf(data: Buffer, name: string, signal: AbortSignal): Promise<string>
  /** describe images with a vision model the user has (absent or resolving to nulls when there is none) */
  describe?(imgs: DescribeImage[], signal: AbortSignal): Promise<(Description | null)[]>
}
export interface ReadAttachmentOptions {
  /** the selected model accepts images */
  vision: boolean
  /** images the selected model's provider accepts per request */
  imageLimit: number
  signal: AbortSignal
  status?(text: string): void
}

/** Images read at the same time (each upscaled copy can take tens of MB). */
const CONCURRENCY = 4

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }))
  return out
}

export function needsReading(atts: Attachment[] | undefined): boolean {
  return !!atts?.some((a) => (a.kind === 'image' && a.data) || (isPdfAttachment(a) && a.data))
}

export async function readAttachments(atts: Attachment[], deps: AttachmentDeps, o: ReadAttachmentOptions): Promise<Map<string, AttachmentReading>> {
  const out = new Map<string, AttachmentReading>()
  const imgs = atts.filter((a) => a.kind === 'image' && a.data && a.mediaType).slice(0, MAX_IMAGES_PER_MESSAGE)
  const pdfs = atts.filter((a) => isPdfAttachment(a) && a.data)
  if (!imgs.length && !pdfs.length) return out
  const what = [imgs.length && `${imgs.length} image${imgs.length === 1 ? '' : 's'}`, pdfs.length && `${pdfs.length} PDF${pdfs.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ')
  o.status?.(`Reading ${what} (text recognition and layout)`)
  const [reads, docs] = await Promise.all([
    mapLimit(imgs, CONCURRENCY, (a) => deps.readImage(Buffer.from(a.data!, 'base64'), o.signal).catch((e) => {
      if (o.signal.aborted) throw e
      return { body: `Text recognition failed: ${(e as Error).message}`, text: '', ok: false }
    })),
    mapLimit(pdfs, 2, (a) => deps.readPdf(Buffer.from(a.data!, 'base64'), a.name, o.signal).catch((e) => {
      if (o.signal.aborted) throw e
      return `The PDF could not be read: ${(e as Error).message}`
    }))
  ])
  const send = o.vision ? Math.max(0, Math.min(imgs.length, o.imageLimit)) : 0
  const rest = imgs.map((_, k) => k).filter((k) => k >= send)
  let desc: (Description | null)[] = []
  if (rest.length && deps.describe) {
    o.status?.(`Asking a vision model to describe ${rest.length} image${rest.length === 1 ? '' : 's'}`)
    desc = await deps.describe(rest.map((k) => ({ name: imgs[k].name, mediaType: imgs[k].mediaType!, data: imgs[k].data!, ocrText: reads[k].text })), o.signal).catch((e) => {
      if (o.signal.aborted) throw e
      return []
    })
  }
  imgs.forEach((a, k) => {
    const d = k >= send ? desc[rest.indexOf(k)] : null
    out.set(a.id, { breakdown: reads[k].body, ocrText: reads[k].text, sendImage: k < send, ...(d ? { vision: d } : {}) })
  })
  pdfs.forEach((a, k) => out.set(a.id, { pdf: docs[k] }))
  return out
}
