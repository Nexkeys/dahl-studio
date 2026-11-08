import path from 'node:path'
import { createRequire } from 'node:module'
import type { PdfItem } from './structure'

/**
 * pdf.js (pdfjs-dist legacy build) in the main process. It runs its "worker" in this thread (no Worker in the main
 * process) and renders pages with @napi-rs/canvas, which pdfjs-dist installs as an optional dependency.
 */
type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type Doc = Awaited<ReturnType<Pdfjs['getDocument']>['promise']>
type Page = Awaited<ReturnType<Doc['getPage']>>

let lib: Promise<Pdfjs> | null = null
function load(): Promise<Pdfjs> {
  lib ??= import('pdfjs-dist/legacy/build/pdf.mjs').catch((e) => {
    lib = null
    throw e
  })
  return lib
}

/** Folder with pdf.js's standard font data (needed to render pages that use the 14 standard PDF fonts). */
function fontDir(): string | undefined {
  try {
    const req = createRequire(typeof __filename === 'string' ? __filename : path.join(process.cwd(), 'index.js'))
    return path.join(path.dirname(req.resolve('pdfjs-dist/package.json')), 'standard_fonts').replace(/\\/g, '/').replace('app.asar/', 'app.asar.unpacked/') + '/'
  } catch {
    return undefined
  }
}

export class PdfError extends Error {}

export interface PdfDoc {
  numPages: number
  info: { title?: string; author?: string; subject?: string; producer?: string; created?: string }
  outline: string[]
  page(n: number): Promise<PdfPage>
  close(): Promise<void>
}
export interface PdfPage {
  width: number
  height: number
  items: PdfItem[]
  /** images drawn on the page */
  images: number
  /** render to PNG at `scale` (1 = 72 dpi) */
  render(scale: number): Promise<Buffer>
}

export async function openPdf(data: Uint8Array, password?: string): Promise<PdfDoc> {
  const pdfjs = await load()
  const task = pdfjs.getDocument({ data: new Uint8Array(data), password, verbosity: 0, standardFontDataUrl: fontDir(), useSystemFonts: false })
  let doc: Doc
  try {
    doc = await task.promise
  } catch (e) {
    const name = (e as Error)?.name ?? ''
    if (name === 'PasswordException') throw new PdfError('This PDF is password-protected. Ask the user to remove the password (or save an unprotected copy) and attach it again.')
    if (name === 'InvalidPDFException') throw new PdfError('This file is not a valid PDF or is damaged (pdf.js could not find its structure).')
    throw new PdfError(`The PDF could not be opened: ${(e as Error)?.message ?? String(e)}`)
  }
  const meta = (await doc.getMetadata().catch(() => null)) as { info?: Record<string, unknown> } | null
  const info = meta?.info ?? {}
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const outline = ((await doc.getOutline().catch(() => null)) ?? []).flatMap((o: { title: string; items?: { title: string }[] }) => [o.title, ...(o.items ?? []).map((i) => `  ${i.title}`)]).slice(0, 80)
  return {
    numPages: doc.numPages,
    info: { title: str(info.Title), author: str(info.Author), subject: str(info.Subject), producer: str(info.Producer), created: str(info.CreationDate) },
    outline,
    page: async (n) => wrapPage(pdfjs, doc, await doc.getPage(n)),
    close: async () => void (await task.destroy().catch(() => {}))
  }
}

async function wrapPage(pdfjs: Pdfjs, doc: Doc, page: Page): Promise<PdfPage> {
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const ops = await page.getOperatorList()
  const imageOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintImageMaskXObject])
  const images = ops.fnArray.filter((f) => imageOps.has(f)).length
  const items: PdfItem[] = []
  for (const it of tc.items as { str?: string; transform: number[]; width: number; fontName: string }[]) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue
    const m = pdfjs.Util.transform(vp.transform, it.transform)
    const size = Math.hypot(m[2], m[3])
    let bold = false
    try {
      const f = page.commonObjs.has(it.fontName) ? (page.commonObjs.get(it.fontName) as { name?: string; bold?: boolean; black?: boolean }) : null
      bold = !!(f && (f.bold || f.black || /bold|black|heavy/i.test(f.name ?? '')))
    } catch {
      /* font not loaded: treat as regular */
    }
    items.push({ str: it.str, x: m[4], y: m[5] - size, w: it.width * (vp.scale || 1), size, bold })
  }
  return {
    width: vp.width,
    height: vp.height,
    items,
    images,
    render: async (scale) => {
      const v = page.getViewport({ scale })
      const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(t: string): Buffer }; context: unknown } } }).canvasFactory
      const cc = factory.create(Math.ceil(v.width), Math.ceil(v.height))
      await page.render({ canvasContext: cc.context, canvas: cc.canvas, viewport: v } as never).promise
      return cc.canvas.toBuffer('image/png')
    }
  }
}
