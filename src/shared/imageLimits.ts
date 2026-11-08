import type { Attachment } from './types'

/** Images one message may carry; each is read (OCR and layout) before the model is called. */
export const MAX_IMAGES_PER_MESSAGE = 15
/** All attachments of one message (images, files, folders, selections). */
export const MAX_ATTACHMENTS = 20

export const isImageAttachment = (a: Attachment): boolean => a.kind === 'image'
export const isPdfAttachment = (a: Pick<Attachment, 'kind' | 'mediaType' | 'name'>): boolean => a.kind === 'file' && (a.mediaType === 'application/pdf' || /\.pdf$/i.test(a.name))

/**
 * Add attachments up to the limits: at most MAX_IMAGES_PER_MESSAGE images and MAX_ATTACHMENTS in total. The same
 * image (name and size) is not added twice. Returns the new list and how many were left out.
 */
export function mergeAttachments(existing: Attachment[], incoming: Attachment[]): { list: Attachment[]; skippedImages: number; skippedOther: number; duplicates: number } {
  const list = [...existing]
  let images = existing.filter(isImageAttachment).length
  let skippedImages = 0, skippedOther = 0, duplicates = 0
  for (const a of incoming) {
    if (list.some((x) => x.kind === a.kind && x.name === a.name && x.bytes === a.bytes && (x.data ?? x.text) === (a.data ?? a.text))) {
      duplicates++
      continue
    }
    const img = isImageAttachment(a)
    if (img && images >= MAX_IMAGES_PER_MESSAGE) skippedImages++
    else if (list.length >= MAX_ATTACHMENTS) (img ? skippedImages++ : skippedOther++)
    else {
      list.push(a)
      if (img) images++
    }
  }
  return { list, skippedImages, skippedOther, duplicates }
}

/** One short sentence for the composer when something was left out, or null. */
export function limitMessage(r: { skippedImages: number; skippedOther: number }): string | null {
  const parts: string[] = []
  if (r.skippedImages) parts.push(`${r.skippedImages} image${r.skippedImages === 1 ? ' was' : 's were'} not added: up to ${MAX_IMAGES_PER_MESSAGE} images per message`)
  if (r.skippedOther) parts.push(`${r.skippedOther} attachment${r.skippedOther === 1 ? ' was' : 's were'} not added: up to ${MAX_ATTACHMENTS} attachments per message`)
  return parts.length ? `${parts.join('. ')}.` : null
}
