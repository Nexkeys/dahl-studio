/** Pure geometry for the OCR pipeline: tiling, merging tile results without duplicates, and grouping words into lines. */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
/** One recognised word; `t` is its text. Boxes are in pixels of the image they were read from. */
export interface OcrWord extends Box {
  t: string
}
/** A run of words on one row with no large gap (a sentence, a label, one table cell). */
export interface OcrLine extends Box {
  text: string
  words: OcrWord[]
  /** 'unclear' lines carry no text: the passes disagreed, so the text is not guessed */
  unclear?: boolean
}

export const area = (b: Box): number => Math.max(0, b.w) * Math.max(0, b.h)
export function intersection(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}
/** Intersection over the smaller box: 1 when one box lies inside the other. */
export function overlapRatio(a: Box, b: Box): number {
  const m = Math.min(area(a), area(b))
  return m > 0 ? intersection(a, b) / m : 0
}
export function union(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
}
export function median(v: number[]): number {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

/**
 * Split a W x H image into tiles no larger than `max` on either side, overlapping by `overlap` px, spread evenly so
 * the last tile ends exactly at the image edge. A single tile when the image already fits.
 */
export function tileGrid(W: number, H: number, max: number, overlap: number): Box[] {
  const spans = (len: number): [number, number][] => {
    if (len <= max) return [[0, len]]
    const ov = Math.min(overlap, Math.floor(max / 2))
    const n = Math.ceil((len - ov) / (max - ov))
    const step = (len - max) / (n - 1)
    return Array.from({ length: n }, (_, i) => {
      const s = Math.round(i * step)
      return [s, Math.min(len, s + max)] as [number, number]
    })
  }
  const out: Box[] = []
  for (const [y0, y1] of spans(H)) for (const [x0, x1] of spans(W)) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  return out
}

/** Words read from one tile, already moved into whole-image coordinates. */
export interface TileWords {
  tile: Box
  words: OcrWord[]
}

/**
 * Merge words from overlapping tiles. A word read twice (in the overlap of two tiles) is kept once: the copy that
 * does not touch a cut edge of its tile wins (the other may be cut off), then the longer text. A word touching a
 * cut edge with no complete copy is kept, since it is the best reading there is.
 */
export function mergeTiles(parts: TileWords[], W: number, H: number, edgeMargin = 3): OcrWord[] {
  type Cand = OcrWord & { tile: number; cut: boolean }
  const all: Cand[] = []
  parts.forEach((p, ti) => {
    const t = p.tile
    for (const w of p.words) {
      const cut = (t.x > 0 && w.x - t.x <= edgeMargin) || (t.x + t.w < W && t.x + t.w - (w.x + w.w) <= edgeMargin) || (t.y > 0 && w.y - t.y <= edgeMargin) || (t.y + t.h < H && t.y + t.h - (w.y + w.h) <= edgeMargin)
      all.push({ ...w, tile: ti, cut })
    }
  })
  const better = (a: Cand, b: Cand): boolean => (a.cut !== b.cut ? !a.cut : a.t.length !== b.t.length ? a.t.length > b.t.length : area(a) > area(b))
  const dropped = new Set<number>()
  for (let i = 0; i < all.length; i++) {
    if (dropped.has(i)) continue
    for (let j = i + 1; j < all.length; j++) {
      if (dropped.has(j) || all[i].tile === all[j].tile) continue
      if (overlapRatio(all[i], all[j]) < 0.5) continue
      if (better(all[j], all[i])) {
        dropped.add(i)
        break
      }
      dropped.add(j)
    }
  }
  return all.filter((_, i) => !dropped.has(i)).map(({ t, x, y, w, h }) => ({ t, x, y, w, h }))
}

/** Move words read from a scaled or cropped image back into original-image coordinates. */
export function toOriginal(words: OcrWord[], scale: number, offX = 0, offY = 0): OcrWord[] {
  return words.map((w) => ({ t: w.t, x: (w.x + offX) / scale, y: (w.y + offY) / scale, w: w.w / scale, h: w.h / scale }))
}

/**
 * Group words into lines: words whose vertical centres are close form a row, and a row is split where the gap
 * between words is larger than `gapFactor` times the row's typical word height (columns, separate UI elements).
 */
export function groupLines(words: OcrWord[], gapFactor = 1.6): OcrLine[] {
  const sorted = [...words].filter((w) => w.t.trim()).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))
  const rows: { cy: number; h: number; words: OcrWord[] }[] = []
  for (const w of sorted) {
    const cy = w.y + w.h / 2
    const row = rows.find((r) => Math.abs(r.cy - cy) < 0.5 * Math.min(r.h, w.h) + 1)
    if (row) {
      row.words.push(w)
      row.cy = row.words.reduce((a, x) => a + x.y + x.h / 2, 0) / row.words.length
      row.h = median(row.words.map((x) => x.h))
    } else rows.push({ cy, h: w.h, words: [w] })
  }
  const lines: OcrLine[] = []
  for (const r of rows) {
    const ws = r.words.sort((a, b) => a.x - b.x)
    let cur: OcrWord[] = []
    const flush = (): void => {
      if (!cur.length) return
      lines.push({ ...union(cur), text: cur.map((x) => x.t).join(' '), words: cur })
      cur = []
    }
    for (const w of ws) {
      const prev = cur[cur.length - 1]
      if (prev && w.x - (prev.x + prev.w) > gapFactor * Math.max(r.h, 4)) flush()
      cur.push(w)
    }
    flush()
  }
  return lines.sort((a, b) => a.y - b.y || a.x - b.x)
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}
