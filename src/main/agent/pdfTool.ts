import { promises as fsp } from 'node:fs'
import { resolveInside } from '../fs/workspace'
import type { ExecCtx, ToolResult } from './toolExec'

/** Largest PDF read from the project (attached PDFs are already in memory). */
const MAX_PDF_BYTES = 100 * 1024 * 1024

/** read_pdf: an attached PDF by name, or a project file; `pages` selects a range. */
export async function execReadPdf(c: ExecCtx, a: { path?: string; pages?: string }): Promise<ToolResult> {
  const p = String(a.path ?? '').trim()
  if (!p) return { ok: false, text: 'Give the path of a PDF in the project, or the name of an attached PDF.' }
  if (!c.deps.readPdf) return { ok: false, text: 'PDF reading is not available.' }
  let data: Buffer
  const att = c.images.get(p)
  if (att && att.mediaType === 'application/pdf') data = Buffer.from(att.data, 'base64')
  else {
    if (!/\.pdf$/i.test(p)) return { ok: false, text: `${p} is not a PDF. Use read_file for text files and analyze_image for images.` }
    const abs = await resolveInside(c.run.project, p)
    const st = await fsp.stat(abs).catch(() => null)
    if (!st?.isFile()) return { ok: false, text: `PDF not found: ${p}. Use a project-relative path or the name of an attached PDF.` }
    if (st.size > MAX_PDF_BYTES) return { ok: false, text: `${p} is larger than 100 MB.` }
    data = await fsp.readFile(abs)
  }
  c.status(`Reading PDF ${p}${a.pages ? ` (pages ${a.pages})` : ''}`)
  try {
    return { ok: true, text: await c.deps.readPdf(data, p, a.pages ? String(a.pages) : undefined, c.signal) }
  } catch (e) {
    return { ok: false, text: (e as Error).message }
  }
}
