import { median } from '../ocr/geometry'
import { openPdf, PdfError, type PdfDoc, type PdfPage } from './pdfjs'
import { pageMarkdown } from './structure'

/**
 * Read a PDF for a model: metadata, then each requested page as Markdown (reading order across columns, headings,
 * lists, tables). Scanned pages (an image and almost no text) are rendered and read with OCR. A long PDF without a
 * page range gets an overview (one line per page) plus the first pages, and the model asks for more by range.
 */

export interface PdfReadOptions {
  /** "3", "1-5", "2,4,7-9"; empty = whole document (or an overview when it is long) */
  pages?: string
  /** stop at a page boundary once the output reaches this many characters */
  maxChars?: number
  /** OCR a rendered page (PNG); returns text in reading order. Without it, scanned pages are only flagged. */
  ocr?: (png: Buffer, signal?: AbortSignal) => Promise<string>
  signal?: AbortSignal
  password?: string
}

/** Documents up to this many pages are read whole when no range is given. */
export const WHOLE_DOC_PAGES = 12
const OVERVIEW_FIRST_PAGES = 3
const OVERVIEW_SCAN_LIMIT = 300
/** fewer non-space characters than this on a page with an image: treat it as scanned */
const SCANNED_CHARS = 40

export function parsePageRange(spec: string | undefined, numPages: number): number[] {
  if (!spec || !String(spec).trim()) return []
  const out = new Set<number>()
  for (const part of String(spec).split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)?\s*(?:-|to|\.\.)\s*(\d+)?$/i.exec(part) ?? /^(\d+)$/.exec(part)
    if (!m) throw new PdfError(`Invalid page range "${spec}". Use for example "3", "1-5" or "2,4,7-9".`)
    const a = Number(m[1] ?? 1)
    const b = m[2] !== undefined ? Number(m[2]) : m[0].includes('-') ? numPages : a
    for (let p = Math.max(1, Math.min(a, b)); p <= Math.min(numPages, Math.max(a, b)); p++) out.add(p)
  }
  if (!out.size) throw new PdfError(`No pages in "${spec}": this PDF has ${numPages} page${numPages === 1 ? '' : 's'}.`)
  return [...out].sort((x, y) => x - y)
}

export async function readPdf(data: Uint8Array, name: string, o: PdfReadOptions = {}): Promise<string> {
  const doc = await openPdf(data, o.password)
  try {
    return await readOpen(doc, name, o)
  } finally {
    await doc.close()
  }
}

const isScanned = (p: PdfPage): boolean => p.images > 0 && p.items.reduce((a, i) => a + i.str.replace(/\s/g, '').length, 0) < SCANNED_CHARS

async function readOpen(doc: PdfDoc, name: string, o: PdfReadOptions): Promise<string> {
  const n = doc.numPages
  const maxChars = o.maxChars ?? 60_000
  let pages = parsePageRange(o.pages, n)
  const head: string[] = [`PDF: ${name}`]
  const i = doc.info
  head.push([i.title && `Title: ${i.title}`, i.author && `Author: ${i.author}`, `Pages: ${n}`, i.subject && `Subject: ${i.subject}`].filter(Boolean).join(' | '))
  if (doc.outline.length && !o.pages) head.push(`Outline:\n${doc.outline.map((t) => `  ${t}`).join('\n')}`)
  const overview = !pages.length && n > WHOLE_DOC_PAGES
  if (!pages.length) pages = Array.from({ length: overview ? OVERVIEW_FIRST_PAGES : n }, (_, k) => k + 1)
  // body text size across the document, so a page of large text is not all "headings"
  const sample = await Promise.all(pages.slice(0, 5).map((p) => doc.page(p)))
  const body = median(sample.flatMap((p) => p.items.map((it) => Math.round(it.size * 2) / 2))) || undefined
  const cached = new Map(sample.map((pg, k) => [pages[k], pg]))
  if (overview) head.push(await overviewLines(doc, n, o.signal))
  const out: string[] = [head.join('\n')]
  let size = out[0].length
  for (const p of pages) {
    if (o.signal?.aborted) throw new Error('cancelled')
    const page = cached.get(p) ?? (await doc.page(p))
    let text: string
    if (isScanned(page)) {
      if (o.ocr) {
        const scale = Math.min(4, Math.max(1.5, 2000 / Math.max(1, page.width)))
        const ocrText = await o.ocr(await page.render(scale), o.signal).catch((e) => `[OCR failed: ${(e as Error).message}]`)
        text = `(Scanned page: the text below was read with OCR. Regions marked unclear could not be read reliably.)\n\n${ocrText.trim() || '(no text found on the scanned image)'}`
      } else text = '(Scanned page: an image with no text layer. Text recognition is not available here.)'
    } else {
      const md = pageMarkdown(page.items, page.width, page.height, body)
      text = `${md.columns > 1 ? `(${md.columns} columns, read column by column)\n\n` : ''}${md.markdown || '(no text on this page)'}`
      if (page.images && md.chars < 400) text += `\n\n(${page.images} image${page.images === 1 ? '' : 's'} on this page, not read)`
    }
    const block = `\n\n---\n## Page ${p} of ${n}\n\n${text}`
    if (size + block.length > maxChars && out.length > 1) {
      out.push(`\n\n[Stopped before page ${p} to keep this reply short. Call read_pdf with pages "${p}-${Math.min(n, p + 9)}" to continue.]`)
      return out.join('')
    }
    out.push(block)
    size += block.length
  }
  if (overview) out.push(`\n\n[This PDF has ${n} pages; pages 1-${OVERVIEW_FIRST_PAGES} are shown. Call read_pdf with a page range (for example pages "4-10") to read more.]`)
  return out.join('')
}

/** One line per page: its first heading or line, how much text it has, and whether it is scanned. */
async function overviewLines(doc: PdfDoc, n: number, signal?: AbortSignal): Promise<string> {
  const lines: string[] = []
  const limit = Math.min(n, OVERVIEW_SCAN_LIMIT)
  for (let p = 1; p <= limit; p++) {
    if (signal?.aborted) throw new Error('cancelled')
    const page = await doc.page(p)
    if (isScanned(page)) {
      lines.push(`  p${p}: scanned image (read it with a page range to run OCR)`)
      continue
    }
    const big = [...page.items].sort((a, b) => b.size - a.size || a.y - b.y)[0]
    const first = big ? page.items.filter((it) => Math.abs(it.y - big.y) < 2).map((it) => it.str).join(' ').trim() : ''
    const chars = page.items.reduce((a, it) => a + it.str.length, 0)
    lines.push(`  p${p}: ${first.slice(0, 90) || '(no text)'} (${chars} chars)`)
  }
  if (limit < n) lines.push(`  (pages ${limit + 1}-${n} not summarised)`)
  return `Page overview:\n${lines.join('\n')}`
}
