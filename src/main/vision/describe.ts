import type { ContentPart } from '@shared/types'
import { batches, imagesPerRequest, maxImageSide, splitDescriptions, type VisionModel } from './limits'

/** Describe images with one of the user's vision models, in batches the provider accepts, OCR text alongside. */

export interface DescribeImage {
  name: string
  mediaType: string
  data: string
  /** local OCR text in reading order (may contain mistakes; unclear regions marked) */
  ocrText: string
}
export interface DescribeDeps {
  /** models to try, best first; only providers with a configured key */
  candidates(): Promise<VisionModel[]>
  chat(modelKey: string, content: ContentPart[], signal: AbortSignal): Promise<string>
  /** downscale to at most `maxSide` px on the longest side */
  shrink(img: { mediaType: string; data: string }, maxSide: number): Promise<{ mediaType: string; data: string }>
  /** a model failed: it is not tried again in this session */
  failed(key: string, err: Error): void
}
export interface Description {
  text: string
  model: string
}

const PROMPT = (n: number): string =>
  `Describe ${n === 1 ? 'this image' : `each of these ${n} images`} in precise detail for a developer who cannot see ${n === 1 ? 'it' : 'them'}: ` +
  'layout and sections from top to bottom, every UI element (buttons, inputs, links, icons, images), all visible text word for word, colours (hex estimates), typography and spacing. ' +
  'Text found by local OCR is given with each image: use it for exact wording, but trust the image where they differ, and say when text is unreadable instead of guessing. ' +
  (n === 1 ? 'Start with the heading "### Image 1".' : 'Start the description of each image with its own heading: "### Image 1", "### Image 2" and so on.')

export async function describeImages(imgs: DescribeImage[], deps: DescribeDeps, signal: AbortSignal): Promise<(Description | null)[]> {
  const out: (Description | null)[] = new Array(imgs.length).fill(null)
  let pending = imgs.map((_, i) => i)
  for (const m of await deps.candidates()) {
    if (!pending.length) break
    const per = imagesPerRequest(m.provider, m.id)
    const side = maxImageSide(m.provider)
    const left: number[] = []
    let broken = false
    for (const batch of batches(pending, per)) {
      if (broken) {
        left.push(...batch)
        continue
      }
      try {
        const content: ContentPart[] = [{ type: 'text', text: PROMPT(batch.length) }]
        for (const [k, i] of batch.entries()) {
          const img = await deps.shrink(imgs[i], side)
          content.push({ type: 'text', text: `Image ${k + 1}: ${imgs[i].name}\nLocal OCR text:\n${imgs[i].ocrText.slice(0, 4000) || '(none found)'}` })
          content.push({ type: 'image', mediaType: img.mediaType, data: img.data, name: imgs[i].name })
        }
        const reply = await deps.chat(m.key, content, signal)
        const parts = splitDescriptions(reply, batch.length)
        batch.forEach((i, k) => (parts[k] ? (out[i] = { text: parts[k]!, model: m.label }) : left.push(i)))
      } catch (e) {
        if (signal.aborted || (e as { kind?: string }).kind === 'cancelled') throw e
        deps.failed(m.key, e as Error)
        broken = true
        left.push(...batch)
      }
    }
    pending = left
  }
  return out
}
