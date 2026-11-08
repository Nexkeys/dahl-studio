import { buildLayout, type Block } from '../ocr/layout'
import { median, type OcrLine, type OcrWord } from '../ocr/geometry'

/**
 * Rebuild a PDF page's structure from positioned text: lines, reading order across columns, headings from font
 * size, lists, and tables (cells aligned in rows and columns) as Markdown. Pure: the input is pdf.js text items
 * already moved to top-left page coordinates.
 */

export interface PdfItem {
  str: string
  /** left edge and top of the text, in points from the top-left corner */
  x: number
  y: number
  w: number
  /** font size in points */
  size: number
  bold?: boolean
}

/** Items on one baseline joined into line segments; a wide gap (a column gutter or a table cell border) splits. */
export function itemsToLines(items: PdfItem[]): OcrLine[] {
  const its = items.filter((i) => i.str.trim() && i.size > 0).sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: { y: number; size: number; items: PdfItem[] }[] = []
  for (const it of its) {
    const row = rows.find((r) => Math.abs(r.y - it.y) < 0.45 * Math.min(r.size, it.size))
    if (row) row.items.push(it)
    else rows.push({ y: it.y, size: it.size, items: [it] })
  }
  const lines: OcrLine[] = []
  for (const r of rows) {
    const sorted = r.items.sort((a, b) => a.x - b.x)
    let seg: PdfItem[] = []
    const flush = (): void => {
      if (!seg.length) return
      let text = ''
      seg.forEach((it, i) => {
        const prev = seg[i - 1]
        const gap = prev ? it.x - (prev.x + prev.w) : 0
        text += prev && gap > 0.12 * it.size && !text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' + it.str : it.str
      })
      const x = seg[0].x
      const size = median(seg.map((s) => s.size))
      const words: OcrWord[] = seg.map((s) => ({ t: s.str.trim(), x: s.x, y: s.y, w: s.w, h: s.size }))
      lines.push({ x, y: Math.min(...seg.map((s) => s.y)), w: Math.max(...seg.map((s) => s.x + s.w)) - x, h: size, text: text.replace(/\s+/g, ' ').trim(), words, ...(seg.every((s) => s.bold) ? { bold: true } : {}) } as OcrLine)
      seg = []
    }
    for (const it of sorted) {
      const prev = seg[seg.length - 1]
      if (prev && it.x - (prev.x + prev.w) > 1.5 * Math.max(prev.size, it.size)) flush()
      seg.push(it)
    }
    flush()
  }
  return lines
}

const BULLET = /^([•●◦▪■‣⁃∙*\-–]|\d{1,3}[.)]|[a-z][.)])\s+/

/** Markdown for one page. `bodySize` is the document's body text size, so headings are judged across pages. */
export function pageMarkdown(items: PdfItem[], width: number, height: number, bodySize?: number): { markdown: string; columns: number; tables: number; chars: number } {
  const lines = itemsToLines(items)
  if (!lines.length) return { markdown: '', columns: 0, tables: 0, chars: 0 }
  const layout = buildLayout({ width, height, lines })
  const body = bodySize ?? median(lines.map((l) => l.h))
  const out: string[] = []
  const grids = new Set<number>()
  for (const b of layout.blocks) {
    if (b.grid !== undefined) {
      if (!grids.has(b.grid)) {
        grids.add(b.grid)
        out.push(tableMarkdown(layout.grids[b.grid]))
      }
      continue
    }
    out.push(blockMarkdown(b, body))
  }
  const markdown = out.filter(Boolean).join('\n\n')
  return { markdown, columns: Math.max(1, layout.columns.length), tables: grids.size, chars: lines.reduce((a, l) => a + l.text.length, 0) }
}

function blockMarkdown(b: Block, body: number): string {
  const lines = b.lines.map((l) => l.text)
  const oneLine = lines.join(' ')
  const words = oneLine.split(/\s+/).length
  if (b.size >= body * 1.6 && words <= 20) return `# ${oneLine}`
  if (b.size >= body * 1.25 && words <= 20) return `## ${oneLine}`
  if (b.lines.length <= 2 && words <= 12 && b.lines.every((l) => (l as OcrLine & { bold?: boolean }).bold) && !BULLET.test(oneLine)) return `### ${oneLine}`
  // lists: a line starting with a bullet or number starts an item; other lines continue the previous one
  if (lines.some((l) => BULLET.test(l))) {
    const items: string[] = []
    for (const l of lines) {
      const m = BULLET.exec(l)
      if (m) items.push(`${/\d/.test(m[1]) ? m[1].replace(')', '.') : '-'} ${l.slice(m[0].length)}`)
      else if (items.length) items[items.length - 1] = joinLine(items[items.length - 1], l)
      else items.push(l)
    }
    return items.join('\n')
  }
  return lines.reduce((acc, l) => (acc ? joinLine(acc, l) : l), '')
}

/** Join wrapped lines; a word split with a hyphen at the line end is joined back. */
function joinLine(a: string, b: string): string {
  if (/[a-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b
  return `${a} ${b}`
}

export function tableMarkdown(rows: Block[][]): string {
  const width = Math.max(...rows.map((r) => r.length))
  // cells line up by x: put each cell in the column whose left edge (from the widest row) is nearest
  const ref = rows.find((r) => r.length === width)!.map((c) => c.x)
  const cell = (s: string): string => s.replace(/\n/g, ' ').replace(/\|/g, '\\|').trim()
  const grid = rows.map((r) => {
    const out = new Array(width).fill('')
    for (const c of r) {
      const i = ref.reduce((best, x, k) => (Math.abs(x - c.x) < Math.abs(ref[best] - c.x) ? k : best), 0)
      out[i] = out[i] ? `${out[i]} ${cell(c.text)}` : cell(c.text)
    }
    return out
  })
  return [`| ${grid[0].join(' | ')} |`, `| ${grid[0].map(() => '---').join(' | ')} |`, ...grid.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n')
}
