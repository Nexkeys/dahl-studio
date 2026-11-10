import { describe, expect, it } from 'vitest'
import type { Attachment, ContentPart } from '../src/shared/types'
import { limitMessage, MAX_IMAGES_PER_MESSAGE, mergeAttachments } from '../src/shared/imageLimits'
import { buildUserContent, capImages, type AttachmentReading } from '../src/main/agent/history'
import { readAttachments } from '../src/main/agent/attachments'
import { batches, imagesPerRequest, pickVisionModels, splitDescriptions } from '../src/main/vision/limits'
import { describeImages } from '../src/main/vision/describe'

const img = (i: number): Attachment => ({ id: `i${i}`, kind: 'image', name: `shot-${i}.png`, mediaType: 'image/png', data: Buffer.from(`png${i}`).toString('base64'), bytes: 10 + i })
const pdf: Attachment = { id: 'p1', kind: 'file', name: 'spec.pdf', mediaType: 'application/pdf', data: Buffer.from('%PDF').toString('base64'), bytes: 4 }
const text = (c: string | ContentPart[]): string => (typeof c === 'string' ? c : c.map((p) => (p.type === 'text' ? p.text : '')).join('\n'))
const imageParts = (c: string | ContentPart[]): number => (typeof c === 'string' ? 0 : c.filter((p) => p.type === 'image').length)

describe('15 images per message', () => {
  it('adds up to 15 images and says how many were left out', () => {
    const r = mergeAttachments([img(0), img(1)], Array.from({ length: 16 }, (_, i) => img(i + 2)))
    expect(r.list.filter((a) => a.kind === 'image')).toHaveLength(MAX_IMAGES_PER_MESSAGE)
    expect(r.skippedImages).toBe(3)
    expect(limitMessage(r)).toBe('3 images were not added: up to 15 images per message.')
  })
  it('skips the same image added twice and keeps the 20-attachment total', () => {
    expect(mergeAttachments([img(1)], [img(1)]).duplicates).toBe(1)
    const files = Array.from({ length: 19 }, (_, i): Attachment => ({ id: `f${i}`, kind: 'file', name: `f${i}.ts`, text: String(i) }))
    const r = mergeAttachments(files, [img(1), img(2)])
    expect(r.list).toHaveLength(20)
    expect(r.skippedImages).toBe(1)
  })
  it('the model gets at most 15 images, with a note about the rest', () => {
    const atts = Array.from({ length: 17 }, (_, i) => img(i))
    const c = buildUserContent('look', atts, new Map())
    expect(imageParts(c)).toBe(15)
    expect(text(c)).toContain('2 more attached image(s) were left out')
  })
})

describe('automatic reading in the user message', () => {
  const readings = new Map<string, AttachmentReading>([
    ['i0', { breakdown: 'Size: 800x600 px\n1. heading "Sign in"', ocrText: 'Sign in', sendImage: false, vision: { text: 'A login form.', model: 'Gemini Flash' } }],
    ['i1', { breakdown: 'Size: 400x300 px\n1. text "Total 42"', ocrText: 'Total 42', sendImage: false }],
    ['p1', { pdf: 'PDF: spec.pdf\nPages: 2\n## Page 1 of 2\nHello' }]
  ])
  it('a text-only model gets each breakdown labelled "Image k of N" and no image data', () => {
    const images = new Map()
    const c = buildUserContent('compare these', [img(0), img(1), pdf], images, readings)
    const t = text(c)
    expect(imageParts(c)).toBe(0)
    expect(t).toContain('Image 1 of 2: shot-0.png')
    expect(t).toContain('Image 2 of 2: shot-1.png')
    expect(t).toContain('1. heading "Sign in"')
    expect(t).toContain('Description from Gemini Flash')
    expect(t).toContain('<attachment type="pdf" name="spec.pdf">\nPDF: spec.pdf')
    // still reachable by name for analyze_image and read_pdf
    expect([...images.keys()]).toEqual(['shot-0.png', 'shot-1.png', 'spec.pdf'])
  })
  it('a vision model gets the image itself plus its OCR text', () => {
    const v = new Map<string, AttachmentReading>([['i0', { breakdown: 'x', ocrText: 'Sign in', sendImage: true }]])
    const c = buildUserContent('what is this', [img(0)], new Map(), v)
    expect(imageParts(c)).toBe(1)
    expect(text(c)).toContain('Image 1 of 1: shot-0.png (attached below')
    expect(text(c)).toContain('Text found in it by OCR (may contain mistakes; trust what you see):\nSign in')
  })
  it('reads every image in parallel before the call, sends a vision model only its provider limit and describes the rest', async () => {
    let running = 0, peak = 0
    const atts = Array.from({ length: 7 }, (_, i) => img(i))
    const described: string[] = []
    const r = await readAttachments([...atts, pdf], {
      readImage: async (b) => {
        peak = Math.max(peak, ++running)
        await new Promise((res) => setTimeout(res, 20))
        running--
        return { body: `breakdown of ${b.toString()}`, text: `text of ${b.toString()}`, ok: true }
      },
      readPdf: async (_b, name) => `markdown of ${name}`,
      describe: async (imgs) => imgs.map((x) => (described.push(x.name), { text: `about ${x.name} (${x.ocrText})`, model: 'Llama 4 Scout' }))
    }, { vision: true, imageLimit: 5, signal: new AbortController().signal })
    expect(peak).toBeGreaterThan(1)
    expect(r.get('i0')).toMatchObject({ sendImage: true, ocrText: 'text of png0' })
    expect(r.get('i5')).toMatchObject({ sendImage: false, vision: { text: 'about shot-5.png (text of png5)' } })
    expect(described).toEqual(['shot-5.png', 'shot-6.png'])
    expect(r.get('p1')).toEqual({ pdf: 'markdown of spec.pdf' })
  })
  it('keeps going when one image cannot be read', async () => {
    const r = await readAttachments([img(0), img(1)], {
      readImage: async (b) => (b.toString() === 'png0' ? Promise.reject(new Error('no OCR language pack')) : { body: 'ok', text: 'ok', ok: true }),
      readPdf: async () => ''
    }, { vision: false, imageLimit: 0, signal: new AbortController().signal })
    expect(r.get('i0')?.breakdown).toContain('no OCR language pack')
    expect(r.get('i1')?.breakdown).toBe('ok')
  })
  it('caps images per request, newest kept', () => {
    const msgs = [0, 1, 2].map((k) => ({ role: 'user' as const, content: [{ type: 'text' as const, text: `m${k}` }, ...[0, 1, 2].map((i) => ({ type: 'image' as const, mediaType: 'image/png', data: 'x', name: `m${k}-${i}` }))] }))
    const out = capImages(msgs, 5)
    expect(out.map((m) => imageParts(m.content as ContentPart[]))).toEqual([0, 2, 3])
    expect(text(out[0].content as ContentPart[])).toContain('not sent: this model accepts 5 image(s) per request')
  })
})

describe('vision routing', () => {
  const models = [
    { key: 'groq:meta-llama/llama-4-scout-17b-16e-instruct', provider: 'groq', id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout', vision: true },
    { key: 'openrouter:qwen/qwen2.5-vl-72b-instruct:free', provider: 'openrouter', id: 'qwen/qwen2.5-vl-72b-instruct:free', label: 'Qwen VL (free)', vision: true },
    { key: 'gemini:gemini-2.5-flash', provider: 'gemini', id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', vision: true },
    { key: 'dahl:deepseek', provider: 'dahl', id: 'deepseek', label: 'DeepSeek', vision: false }
  ]
  it('knows per-provider image limits', () => {
    expect(imagesPerRequest('groq', 'meta-llama/llama-4-scout-17b-16e-instruct')).toBe(5)
    expect(imagesPerRequest('gemini', 'gemini-2.5-flash')).toBeGreaterThanOrEqual(15)
    expect(imagesPerRequest('openrouter', 'x:free')).toBe(4)
    expect(batches([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 5).map((b) => b.length)).toEqual([5, 5, 2])
  })
  it('never picks a provider without a key, and prefers the selected model', () => {
    expect(pickVisionModels(models, 'dahl:deepseek', () => false, new Set())).toEqual([])
    expect(pickVisionModels(models, null, (p) => p === 'groq', new Set()).map((m) => m.provider)).toEqual(['groq'])
    expect(pickVisionModels(models, 'openrouter:qwen/qwen2.5-vl-72b-instruct:free', () => true, new Set()).map((m) => m.provider)).toEqual(['openrouter', 'gemini'])
  })
  it('splits one reply into per-image descriptions', () => {
    expect(splitDescriptions('### Image 1\nA form.\n### Image 2\nA chart.', 2)).toEqual(['A form.', 'A chart.'])
    expect(splitDescriptions('Just a cat.', 1)).toEqual(['Just a cat.'])
  })
  it('sends 12 images to a Groq model in batches of 5 with the OCR text, then falls back when a model fails', async () => {
    const calls: { model: string; images: number; text: string }[] = []
    const imgs = Array.from({ length: 12 }, (_, i) => ({ name: `s${i}.png`, mediaType: 'image/png', data: 'eA==', ocrText: `ocr ${i}` }))
    const failed: string[] = []
    const out = await describeImages(imgs, {
      candidates: async () => [models[0], models[2]],
      shrink: async (x) => x,
      failed: (k) => failed.push(k),
      chat: async (model, content) => {
        const n = content.filter((p) => p.type === 'image').length
        calls.push({ model, images: n, text: text(content) })
        if (model.startsWith('groq') && calls.length === 3) throw new Error('rate limited')
        return Array.from({ length: n }, (_, k) => `### Image ${k + 1}\ndescribed by ${model}`).join('\n')
      }
    }, new AbortController().signal)
    expect(calls.map((c) => `${c.model.split(':')[0]}:${c.images}`)).toEqual(['groq:5', 'groq:5', 'groq:2', 'gemini:2'])
    expect(calls[0].text).toContain('Local OCR text:\nocr 0')
    expect(failed).toEqual(['groq:meta-llama/llama-4-scout-17b-16e-instruct'])
    expect(out.every((d) => d && d.text.startsWith('described by'))).toBe(true)
    expect(out[11]?.model).toBe('Gemini 2.5 Flash')
  })
})
