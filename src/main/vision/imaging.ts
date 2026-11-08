import sharp from 'sharp'
import type { Attachment, ChatMessage, ModelInfo, Settings } from '@shared/types'
import { readImage } from '../ocr/read'
import { accurateEngine } from '../ocr/accurate'
import { readPdf } from '../pdf/read'
import { readAttachments } from '../agent/attachments'
import type { AttachmentReading } from '../agent/history'
import { describeImages, type DescribeImage } from './describe'
import { imagesPerRequest, pickVisionModels } from './limits'

/**
 * Image and PDF reading wired to the app: OCR engine choice (Settings > Accurate OCR), vision models from the
 * user's configured providers, and the functions the agent runner and tools call. Built by services.ts.
 */
export interface ImagingDeps {
  appDir: string
  models(): Promise<ModelInfo[]>
  findModel(key: string): Promise<ModelInfo | undefined>
  chat(req: { model: string; vision: boolean; messages: ChatMessage[] }, signal: AbortSignal): Promise<{ content: string }>
  /** a key is configured for this provider and it is not known to be failing */
  providerUsable(provider: string): Promise<boolean>
  settings(): Promise<Settings & { accurateOcr?: boolean }>
  log(level: 'info' | 'error', msg: string): void
}

/** Downscale for a vision request; small images are sent as they are. */
async function shrink(img: { mediaType: string; data: string }, maxSide: number): Promise<{ mediaType: string; data: string }> {
  const buf = Buffer.from(img.data, 'base64')
  const meta = await sharp(buf).metadata().catch(() => null)
  if (!meta?.width || !meta.height || Math.max(meta.width, meta.height) <= maxSide) return img
  const jpeg = /jpe?g/.test(img.mediaType)
  const out = await sharp(buf).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside' })[jpeg ? 'jpeg' : 'png'](jpeg ? { quality: 88 } : {}).toBuffer()
  return { mediaType: jpeg ? 'image/jpeg' : 'image/png', data: out.toString('base64') }
}

export function createImaging(d: ImagingDeps) {
  const failed = new Set<string>()
  const candidates = async () => {
    const ms = await d.models()
    const usable = new Map<string, boolean>()
    for (const p of new Set(ms.map((m) => m.provider as string))) usable.set(p, await d.providerUsable(p).catch(() => false))
    return pickVisionModels(ms, (await d.settings()).defaultModel, (p) => usable.get(p) === true, failed)
  }
  const describe = (imgs: DescribeImage[], signal: AbortSignal) =>
    describeImages(imgs, {
      candidates,
      chat: async (model, content, sig) => (await d.chat({ model, vision: true, messages: [{ role: 'user', content }] }, sig)).content,
      shrink,
      failed: (key, e) => {
        failed.add(key) // not retried in this session
        d.log('info', `vision assist: ${key} unavailable (${e.message.slice(0, 160)}); trying the next option`)
      }
    }, signal)
  const engine = async (): Promise<Awaited<ReturnType<typeof accurateEngine>>> =>
    (await d.settings()).accurateOcr ? accurateEngine(d.appDir).catch((e) => ({ note: `Note: Accurate OCR failed (${(e as Error).message}); Windows OCR was used.` })) : {}
  const readImg = async (data: Buffer, signal?: AbortSignal) => {
    const e = await engine()
    return readImage(data, { signal, engine: e.engine, note: e.note })
  }
  /** OCR for scanned PDF pages: plain text in reading order with unclear regions marked */
  const ocrPng = async (png: Buffer, signal?: AbortSignal) => (await readImg(png, signal)).text
  return {
    /** the analyze_image tool */
    analyzeImage: async (name: string, mediaType: string, data: string, signal: AbortSignal): Promise<string> => {
      const r = await readImg(Buffer.from(data, 'base64'), signal)
      const [v] = await describe([{ name, mediaType, data, ocrText: r.text }], signal).catch(() => [null])
      return `Image breakdown: ${name}\n${r.body}${v ? `\n\nDescription from ${v.model} (a vision model):\n${v.text}` : ''}`
    },
    /** images and PDFs attached to a message, read before the first model call */
    readAttachments: async (atts: Attachment[], model: string, signal: AbortSignal, status: (t: string) => void): Promise<Map<string, AttachmentReading>> => {
      const info = await d.findModel(model)
      return readAttachments(atts, { readImage: readImg, readPdf: (b, name, s) => readPdf(b, name, { maxChars: 40_000, ocr: ocrPng, signal: s }), describe }, {
        vision: !!info?.vision, imageLimit: info?.vision ? imagesPerRequest(info.provider, info.id) : 0, signal, status
      })
    },
    /** images per request the model's provider accepts (0 for a model that cannot see images) */
    imageLimit: async (model: string): Promise<number> => {
      const info = await d.findModel(model)
      return info?.vision ? imagesPerRequest(info.provider, info.id) : 0
    },
    /** the read_pdf tool */
    readPdf: (data: Buffer, name: string, pages: string | undefined, signal: AbortSignal) => readPdf(data, name, { pages, ocr: ocrPng, signal })
  }
}
