import { overlapRatio, union, type Box, type OcrWord } from './geometry'

/**
 * Confidence without engine scores: Windows OCR gives no per-word confidence, so the image is read twice with
 * different preprocessing (scale and contrast). Where both readings agree the text is trusted. Where they differ the
 * region is read a third time, larger; a reading two passes agree on wins, otherwise the region is "unclear".
 */

export interface Dispute {
  box: Box
  /** text of reading A / B in this region (null when that pass saw nothing there) */
  a: string | null
  b: string | null
  aWords: OcrWord[]
  bWords: OcrWord[]
}
export interface Comparison {
  agreed: OcrWord[]
  disputes: Dispute[]
}

/** Typographic variants that are the same character for a reader. */
export const normText = (s: string): string =>
  s.normalize('NFKC').replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/\s+/g, '')

const linked = (a: OcrWord, b: OcrWord): boolean => {
  const dy = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2))
  return dy < 0.6 * Math.min(a.h, b.h) + 1 && overlapRatio(a, b) > 0.35
}

/** Group words from two readings that cover the same spot, then compare each group's text. */
export function compareReadings(a: OcrWord[], b: OcrWord[]): Comparison {
  const all = [...a.map((w) => ({ w, src: 0 })), ...b.map((w) => ({ w, src: 1 }))]
  const parent = all.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (linked(a[i], b[j])) parent[find(i)] = find(a.length + j)
  const groups = new Map<number, { aw: OcrWord[]; bw: OcrWord[] }>()
  all.forEach((x, i) => {
    const g = groups.get(find(i)) ?? { aw: [], bw: [] }
    ;(x.src ? g.bw : g.aw).push(x.w)
    groups.set(find(i), g)
  })
  const out: Comparison = { agreed: [], disputes: [] }
  const text = (ws: OcrWord[]): string => [...ws].sort((p, q) => p.x - q.x).map((w) => w.t).join(' ')
  for (const g of groups.values()) {
    const at = g.aw.length ? text(g.aw) : null
    const bt = g.bw.length ? text(g.bw) : null
    if (at !== null && bt !== null && normText(at) === normText(bt)) out.agreed.push(...g.aw)
    else out.disputes.push({ box: union([...g.aw, ...g.bw]), a: at, b: bt, aWords: g.aw, bWords: g.bw })
  }
  return out
}

export interface Resolution {
  words: OcrWord[]
  unclear: Box[]
}

/** Settle each disputed region with a third reading `c` (words in the same coordinates). */
export function resolveDisputes(disputes: Dispute[], c: OcrWord[]): Resolution {
  const res: Resolution = { words: [], unclear: [] }
  for (const d of disputes) {
    const cw = c.filter((w) => overlapRatio(w, d.box) > 0.35)
    const ct = cw.length ? normText(cw.sort((p, q) => p.x - q.x).map((w) => w.t).join('')) : ''
    const at = d.a === null ? null : normText(d.a)
    const bt = d.b === null ? null : normText(d.b)
    if (ct && ct === at) res.words.push(...d.aWords)
    else if (ct && ct === bt) res.words.push(...cw)
    else if (!ct && (at === null || bt === null)) {
      // only one of three readings saw anything here: a short mark (an icon read as "O" or "@") is noise; longer text
      // seen once is reported as unclear rather than dropped or trusted
      const seen = at ?? bt ?? ''
      if (seen.length > 2 && /[\p{L}\p{N}]{2}/u.test(seen)) res.unclear.push(d.box)
    } else res.unclear.push(d.box)
  }
  return res
}
