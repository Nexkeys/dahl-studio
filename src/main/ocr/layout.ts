import { median, union, type Box, type OcrLine } from './geometry'
import { palette, regionColours, ringColour, dist, saturated, type RgbImage } from './colors'

/**
 * Layout from OCR boxes: lines become text blocks, blocks are put in reading order (recursive XY cut: columns left
 * to right, bands top to bottom; aligned grids such as tables row by row), sizes fall into tiers, and each block
 * gets its colours and a guess of what it is (heading, button, input, link, text).
 */

export type BlockKind = 'heading' | 'button' | 'input' | 'link' | 'text' | 'unclear'
export interface Block extends Box {
  lines: OcrLine[]
  text: string
  /** typical line height in px (original image) */
  size: number
  /** 1 = largest text on the image */
  tier: number
  kind: BlockKind
  fg?: string
  bg?: string
  contrast?: number
  /** index of the grid (table) this block belongs to, when the blocks around it form rows and columns */
  grid?: number
}
export interface Layout {
  blocks: Block[]
  /** x ranges of the top-level columns, when the image has more than one */
  columns: { x: number; w: number }[]
  tiers: { size: number; blocks: number }[]
  /** blocks of each detected grid, as rows of cells */
  grids: Block[][][]
  readingText: string
}

const lineSize = (l: OcrLine): number => (l.words.length ? median(l.words.map((w) => w.h)) : l.h)

/** Consecutive lines with similar size, small vertical gap and aligned left edges (or overlap) form one block. */
export function makeBlocks(lines: OcrLine[]): Block[] {
  const blocks: Block[] = []
  for (const l of [...lines].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const s = lineSize(l)
    const hit = l.unclear ? undefined : blocks.find((b) => {
      if (b.kind === 'unclear') return false
      const last = b.lines[b.lines.length - 1]
      const ls = lineSize(last)
      const gap = l.y - (last.y + last.h)
      const xOverlap = Math.min(l.x + l.w, b.x + b.w) - Math.max(l.x, b.x)
      return gap > -0.5 * s && gap < 0.9 * Math.max(s, ls) && Math.max(s, ls) / Math.min(s, ls) < 1.35 && (Math.abs(l.x - last.x) < 1.2 * s || xOverlap > 0.6 * Math.min(l.w, b.w))
    })
    if (hit) {
      hit.lines.push(l)
      Object.assign(hit, union([hit, l]))
      hit.size = median(hit.lines.map(lineSize))
    } else blocks.push({ ...union([l]), lines: [l], text: '', size: s, tier: 0, kind: l.unclear ? 'unclear' : 'text' })
  }
  for (const b of blocks) b.text = b.lines.map((l) => l.text).join('\n')
  return blocks
}

/** Free x (or y) ranges inside the span of the boxes, at least `min` wide. */
function gaps(boxes: Box[], axis: 'x' | 'y', min: number): [number, number][] {
  const iv = boxes.map((b) => (axis === 'x' ? [b.x, b.x + b.w] : [b.y, b.y + b.h])).sort((p, q) => p[0] - q[0])
  const out: [number, number][] = []
  let end = iv[0][1]
  for (const [s, e] of iv.slice(1)) {
    if (s - end >= min) out.push([end, s])
    end = Math.max(end, e)
  }
  return out
}
function splitAt(blocks: Block[], cuts: [number, number][], axis: 'x' | 'y'): Block[][] {
  const groups: Block[][] = cuts.map(() => [])
  groups.push([])
  for (const b of blocks) {
    const c = (axis === 'x' ? b.x : b.y)
    groups[cuts.filter(([s]) => c >= s).length].push(b)
  }
  return groups.filter((g) => g.length)
}

/**
 * Columns whose lines line up row by row, are short (cells) and share one text size: a table. Side-by-side cards
 * also line up, but mix sizes (a small label over a large number), so they are read card by card instead.
 */
function isGrid(cols: Block[][], span: number): boolean {
  if (cols.length < 2) return false
  const centres = cols.map((c) => c.flatMap((b) => b.lines.map((l) => ({ cy: l.y + l.h / 2, h: l.h, w: l.w, s: lineSize(l) }))))
  if (centres.some((c) => c.length < 2)) return false
  const widths = centres.flat().map((c) => c.w)
  if (median(widths) > 0.35 * span) return false
  const sizes = centres.flat().map((c) => c.s)
  if (Math.max(...sizes) / Math.max(1, Math.min(...sizes)) > 1.3) return false
  // cells are short; lines of running text in two columns also line up, but are long
  if (median(cols.flatMap((c) => c.flatMap((b) => b.lines.map((l) => l.text.length)))) > 30) return false
  for (let i = 0; i + 1 < cols.length; i++) {
    const [a, b] = [centres[i], centres[i + 1]]
    const hits = a.filter((p) => b.some((q) => Math.abs(p.cy - q.cy) < 0.4 * Math.min(p.h, q.h) + 1)).length
    if (hits / a.length < 0.7 || hits / b.length < 0.7) return false
  }
  return true
}

/**
 * Recursive XY cut. `grids` collects the rows of every grid found.
 * - Columns (a vertical gap through everything) are read left to right, except that a title above or a note below
 *   the columns is split off first (it starts above, or ends below, every column's text).
 * - Otherwise horizontal bands are read top to bottom, but consecutive bands with gaps at the same x positions
 *   (rows of side-by-side cards, rows of a table) are kept together, so cards are read one by one and a table as a
 *   grid instead of row fragments.
 */
function order(blocks: Block[], unit: number, grids: Block[][][]): Block[] {
  if (blocks.length <= 1) return blocks
  const span = Math.max(...blocks.map((b) => b.x + b.w)) - Math.min(...blocks.map((b) => b.x))
  const vx = gaps(blocks, 'x', Math.max(8, 0.9 * unit))
  if (vx.length) {
    const cols = splitAt(blocks, vx, 'x')
    const innerTop = Math.max(...cols.map((c) => Math.min(...c.map((b) => b.y))))
    const innerBottom = Math.min(...cols.map((c) => Math.max(...c.map((b) => b.y + b.h))))
    // only a gap clearly wider than the spacing inside the columns: a sidebar that simply runs longer than the main
    // content is not cut (its last items stay with it)
    const inner = cols.flatMap((c) => [...c].sort((p, q) => p.y - q.y).map((b, i, s) => (i ? b.y - (s[i - 1].y + s[i - 1].h) : 0)).filter((g) => g > 0))
    const min = Math.max(0.8 * unit, 1.3 * median(inner))
    const outer = gaps(blocks, 'y', min).filter(([s, e]) => e - s > min && (e <= innerTop + 1 || s >= innerBottom - 1))
    if (outer.length) return splitAt(blocks, outer, 'y').flatMap((g) => order(g, unit, grids))
    if (isGrid(cols, span)) {
      // a column of cells may have been joined into one block: every line is a cell here
      const cells = blocks.flatMap((b) => (b.lines.length > 1 ? b.lines.map((l): Block => ({ ...b, ...union([l]), lines: [l], text: l.text })) : [b]))
      const rows = rowsOf(cells)
      const id = grids.push(rows) - 1
      for (const b of cells) b.grid = id
      return rows.flat()
    }
    return cols.flatMap((c) => order(c, unit, grids))
  }
  const hy = gaps(blocks, 'y', 1)
  if (hy.length) {
    const bands: Block[][] = []
    let prev: [number, number][] = []
    for (const band of splitAt(blocks, hy, 'y')) {
      const g = gaps(band, 'x', Math.max(8, 0.9 * unit))
      if (bands.length && sameGutters(prev, g)) bands[bands.length - 1].push(...band)
      else bands.push(band)
      prev = g
    }
    // a merged group has a vertical gap through it, so it is ordered as columns (or a grid) one level down
    if (bands.length > 1) return bands.flatMap((g) => order(g, unit, grids))
    return bands[0].length < blocks.length ? order(bands[0], unit, grids) : [...blocks].sort((a, b) => a.y - b.y || a.x - b.x)
  }
  return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x)
}
function sameGutters(a: [number, number][], b: [number, number][]): boolean {
  if (!a.length || !b.length) return false
  const [few, many] = a.length <= b.length ? [a, b] : [b, a]
  return few.every(([s, e]) => many.some(([s2, e2]) => Math.min(e, e2) - Math.max(s, s2) > 0))
}
function rowsOf(blocks: Block[]): Block[][] {
  const rows: Block[][] = []
  for (const b of [...blocks].sort((p, q) => p.y + p.h / 2 - (q.y + q.h / 2))) {
    const r = rows.find((row) => Math.abs(row[0].y + row[0].h / 2 - (b.y + b.h / 2)) < 0.5 * Math.min(row[0].h, b.h) + 1)
    if (r) r.push(b)
    else rows.push([b])
  }
  return rows.map((r) => r.sort((p, q) => p.x - q.x))
}

/** Sizes within 15% of each other are one tier; tier 1 is the largest. */
export function sizeTiers(sizes: number[]): { size: number; members: number[] }[] {
  const tiers: { size: number; members: number[] }[] = []
  for (const s of [...sizes].sort((a, b) => b - a)) {
    const t = tiers.find((x) => Math.abs(x.size - s) / x.size < 0.15)
    if (t) t.members.push(s)
    else tiers.push({ size: s, members: [s] })
  }
  for (const t of tiers) t.size = Math.round(median(t.members))
  return tiers
}

export function buildLayout(o: { width: number; height: number; lines: OcrLine[]; px?: RgbImage }): Layout {
  const blocks = makeBlocks(o.lines)
  const text = blocks.filter((b) => b.kind !== 'unclear')
  const unit = median(text.map((b) => b.size)) || 12
  const tiers = sizeTiers(text.map((b) => b.size))
  for (const b of text) b.tier = 1 + tiers.findIndex((t) => t.members.includes(b.size))
  // body text size: the size most of the characters are set in
  const bySize = [...text].sort((a, b) => a.size - b.size)
  const half = bySize.reduce((a, b) => a + b.text.length, 0) / 2
  let acc = 0
  const body = bySize.find((b) => (acc += b.text.length) >= half)?.size ?? unit
  const page = o.px ? (palette(o.px, 1)[0]?.hex ?? null) : null
  for (const b of text) classify(b, body, o.px, page)
  const grids: Block[][][] = []
  const ordered = order(blocks, unit, grids)
  const cols = gaps(blocks.length ? blocks : [{ x: 0, y: 0, w: o.width, h: o.height }], 'x', Math.max(8, 0.9 * unit))
  const xs = [0, ...cols.map(([s, e]) => (s + e) / 2), o.width]
  return {
    blocks: ordered,
    columns: cols.length && !ordered.every((b) => b.grid !== undefined) ?xs.slice(1).map((x, i) => ({ x: Math.round(xs[i]), w: Math.round(x - xs[i]) })) : [],
    tiers: tiers.map((t) => ({ size: t.size, blocks: t.members.length })),
    grids,
    readingText: ordered.filter((b) => b.kind !== 'unclear').map((b) => b.text).join('\n')
  }
}

/** Guess what a block is from its size, length, colours and what it sits on. */
function classify(b: Block, body: number, px: RgbImage | undefined, page: string | null): void {
  const words = b.text.split(/\s+/).filter(Boolean).length
  if (px) {
    const c = regionColours(px, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 })
    if (c) Object.assign(b, c)
  }
  const short = b.lines.length === 1 && words <= 4 && b.text.length <= 32
  const filled = !!(px && b.bg && page && dist(b.bg, page) > 120 && ringColour(px, b, b.size * 0.6) === b.bg)
  if (short && filled) b.kind = 'button'
  else if (short && px && hasFrame(px, b)) b.kind = 'input'
  else if (b.size > body * 1.3 && words <= 14 && b.lines.length <= 2) b.kind = 'heading'
  else if (short && b.fg && saturated(b.fg) && b.bg && !saturated(b.bg)) b.kind = 'link'
}

/** A thin frame around the text that reaches well past its right end: the border of a text field. */
function hasFrame(px: RgbImage, b: Block): boolean {
  if (!b.bg) return false
  const k = px.scale
  const at = (x: number, y: number): string | null => {
    const xi = Math.round(x * k), yi = Math.round(y * k)
    if (xi < 0 || yi < 0 || xi >= px.width || yi >= px.height) return null
    const o = (yi * px.width + xi) * px.channels
    return '#' + [px.data[o], px.data[o + 1], px.data[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')
  }
  const cy = b.y + b.h / 2
  const edgeLeft = Array.from({ length: Math.ceil(b.size * 1.5) }, (_, i) => at(b.x - 2 - i, cy)).some((c) => c && dist(c, b.bg!) > 40)
  if (!edgeLeft) return false
  let right = -1
  for (let x = b.x + b.w + 2; x < b.x + b.w + 40 * b.size && x < px.width / k; x++) {
    const c = at(x, cy)
    if (c && dist(c, b.bg) > 40) {
      right = x
      break
    }
  }
  const above = Array.from({ length: Math.ceil(b.size * 1.2) }, (_, i) => at(b.x + b.w / 2, b.y - 2 - i)).some((c) => c && dist(c, b.bg!) > 40)
  return right > b.x + b.w + 2 * b.size && above
}
