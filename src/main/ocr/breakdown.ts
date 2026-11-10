import { palette, type RgbImage } from './colors'
import type { Layout } from './layout'
import type { OcrOutcome } from './pipeline'

/** The text breakdown a model that cannot see images gets: what the image says, where, and how it looks. */

const r = Math.round
const MAX_BLOCKS = 140
const MAX_BLOCK_CHARS = 600

export interface ImageFacts {
  width: number
  height: number
  dark: boolean
  palette: { hex: string; pct: number }[]
}

export function imageFacts(px: RgbImage, width: number, height: number, dark: boolean): ImageFacts {
  return { width: r(width), height: r(height), dark, palette: palette(px, 8) }
}

/** Plain text in reading order with unclear regions marked, for a vision model or a quick summary. */
export function readingText(layout: Layout, max = 6000): string {
  const t = layout.blocks.map((b) => (b.kind === 'unclear' ? `[unclear text at ${r(b.x)},${r(b.y)}]` : b.text)).join('\n')
  return t.length > max ? `${t.slice(0, max)}\n[text cut at ${max} characters]` : t
}

export function formatBreakdown(facts: ImageFacts, ocr: OcrOutcome | string, layout: Layout | null, engineName = 'Windows OCR'): string {
  const out: string[] = []
  out.push(`Size: ${facts.width}x${facts.height} px, ${facts.dark ? 'dark theme (light text on a dark background)' : 'light theme'}`)
  out.push(`Dominant colours: ${facts.palette.map((p) => `${p.hex} ${p.pct}%`).join(', ')}`)
  if (typeof ocr === 'string') {
    out.push(`Text recognition: unavailable (${ocr})`)
    return out.join('\n')
  }
  if (!layout || !layout.blocks.length) {
    out.push(`Text recognition (${engineName}): no text found`)
    return out.join('\n')
  }
  const unclear = layout.blocks.filter((b) => b.kind === 'unclear')
  out.push(`Text recognition (${engineName}${ocr.lang ? `, ${ocr.lang}` : ''}): read at ${ocr.scale}x in ${ocr.passes} passes; text that the passes did not agree on is marked unclear, not guessed.`)
  if (layout.columns.length > 1) out.push(`Columns: ${layout.columns.length} (${layout.columns.map((c) => `x ${c.x} to ${c.x + c.w}`).join(', ')})`)
  if (layout.tiers.length) out.push(`Text sizes (line height): ${layout.tiers.map((t, i) => `tier ${i + 1} about ${t.size} px (${t.blocks} block${t.blocks === 1 ? '' : 's'})`).join(', ')}`)
  out.push('', 'Content in reading order. Each block: kind, position x,y and size in px, size tier, text colour on background (contrast ratio), then its text:')
  let n = 0
  const shownGrids = new Set<number>()
  for (const b of layout.blocks) {
    if (n >= MAX_BLOCKS) {
      out.push(`[${layout.blocks.length - n} more blocks not listed]`)
      break
    }
    if (b.grid !== undefined) {
      if (shownGrids.has(b.grid)) continue
      shownGrids.add(b.grid)
      const rows = layout.grids[b.grid]
      const box = rows.flat()
      const x = Math.min(...box.map((c) => c.x)), y = Math.min(...box.map((c) => c.y))
      out.push(`${++n}. table or grid at ${r(x)},${r(y)}, ${rows.length} rows (cells separated by |):`)
      for (const row of rows) out.push(`   | ${row.map((c) => c.text.replace(/\n/g, ' ')).join(' | ')} |`)
      continue
    }
    const where = `at ${r(b.x)},${r(b.y)} ${r(b.w)}x${r(b.h)}`
    if (b.kind === 'unclear') {
      out.push(`${++n}. unclear text ${where} (could not be read reliably)`)
      continue
    }
    const colour = b.fg && b.bg ? `, ${b.fg} on ${b.bg} (${b.contrast}:1${b.contrast! < 4.5 ? ', low contrast' : ''})` : ''
    const text = b.text.length > MAX_BLOCK_CHARS ? `${b.text.slice(0, MAX_BLOCK_CHARS)} [cut]` : b.text
    out.push(`${++n}. ${b.kind} ${where}, tier ${b.tier}${colour}: ${text.includes('\n') ? `\n   ${text.replace(/\n/g, '\n   ')}` : `"${text}"`}`)
  }
  if (unclear.length) out.push('', `${unclear.length} region${unclear.length === 1 ? '' : 's'} with unclear text (listed above with positions). Ask the user, or a vision model, if that text matters.`)
  return out.join('\n')
}
