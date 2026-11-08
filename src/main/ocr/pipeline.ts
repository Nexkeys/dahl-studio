import { compareReadings, resolveDisputes } from './consensus'
import { groupLines, median, mergeTiles, tileGrid, toOriginal, union, type Box, type OcrLine, type OcrWord } from './geometry'
import { contrastSpread, isDark, prepare, removeQuietly, rgbPixels, writeRegion, writeStrip, type Raw } from './preprocess'
import { windowsOcrHelper, type OcrInfo, type RawOcr } from './windowsOcr'

/** Text height OCR reads best at, in pixels (word box height after scaling). */
export const TARGET_TEXT_PX = 30
const MAX_SCALE = 4
/** upper bound for the scaled image, so a huge screenshot is not blown up to hundreds of megapixels */
const MAX_SCALED_PIXELS = 40_000_000

export interface OcrEngineFns {
  recognize(file: string): Promise<RawOcr>
  info(): Promise<OcrInfo>
}
const windowsEngine: OcrEngineFns = { recognize: (f) => windowsOcrHelper.recognize(f), info: () => windowsOcrHelper.info() }

export interface OcrOutcome {
  width: number
  height: number
  /** recognised lines (row segments) in original-image pixels, top to bottom; unclear ones have no text */
  lines: OcrLine[]
  /** median word height in the original image, px */
  textHeight: number
  scale: number
  inverted: boolean
  passes: number
  tiles: number
  lang: string
  ms: number
  /** pixels the layout step samples colours from (RGB, possibly downscaled by `pxScale`) */
  px: Raw & { scale: number }
}

export interface OcrOptions {
  engine?: OcrEngineFns
  /** second and third readings for confidence (default on) */
  verify?: boolean
  signal?: AbortSignal
}

/** Read one prepared image, tiled when it is larger than the engine's limit; words come back in its coordinates. */
async function readPass(e: OcrEngineFns, img: Raw, maxTile: number, overlap: number, signal?: AbortSignal): Promise<{ words: OcrWord[]; tiles: number }> {
  const tiles = tileGrid(img.width, img.height, maxTile, overlap)
  const parts: { tile: Box; words: OcrWord[] }[] = []
  for (const tile of tiles) {
    if (signal?.aborted) throw new Error('cancelled')
    const file = await writeRegion(img, tiles.length > 1 ? tile : undefined)
    try {
      const r = await e.recognize(file)
      parts.push({ tile, words: r.lines.flat().map((w) => ({ ...w, x: w.x + tile.x, y: w.y + tile.y })) })
    } finally {
      void removeQuietly(file)
    }
  }
  return { words: tiles.length > 1 ? mergeTiles(parts, img.width, img.height) : parts[0].words, tiles: tiles.length }
}

/** Pick the scale that brings the median word height to about TARGET_TEXT_PX (only upscales, except huge text). */
export function chooseScale(textHeight: number, W: number, H: number): number {
  let s = textHeight > 0 ? TARGET_TEXT_PX / textHeight : 2.5
  if (textHeight > 0 && textHeight < 3 * TARGET_TEXT_PX) s = Math.max(1, s)
  s = Math.min(MAX_SCALE, s, Math.sqrt(MAX_SCALED_PIXELS / Math.max(1, W * H)))
  return Math.round(s * 100) / 100
}

/**
 * Full OCR of one image: decode, detect dark mode (inverted), reading A upscaled (re-read at the scale that brings
 * the measured text height to about 30 px when it is far off), reading B at another scale, and a third, larger
 * reading of every region where A and B disagree (all such regions stacked into one strip: one OCR call).
 */
export async function ocrImage(input: Buffer, o: OcrOptions = {}): Promise<OcrOutcome> {
  const t0 = Date.now()
  const e = o.engine ?? windowsEngine
  const info = await e.info()
  const maxTile = Math.min(info.maxDim, 4096)
  const px = await rgbPixels(input, 6000)
  const W = px.width, H = px.height
  const inverted = isDark(px)
  let passes = 0, tiles = 0
  const debug = process.env.DAHL_OCR_DEBUG ? (m: string) => console.log(`[ocr ${Date.now() - t0} ms] ${m}`) : () => {}
  const run = async (img: Raw, scale: number, overlap: number): Promise<OcrWord[]> => {
    debug(`pass ${passes + 1}: ${img.width}x${img.height} at ${scale}x`)
    const r = await readPass(e, img, maxTile, overlap, o.signal)
    passes++
    tiles += r.tiles
    debug(`pass ${passes} done: ${r.words.length} words, ${r.tiles} tiles${process.env.DAHL_OCR_DEBUG === '2' ? `: ${r.words.map((w) => w.t).join(' ')}` : ''}`)
    return toOriginal(r.words, scale)
  }
  // Measured on the eval set (30 screenshots, scripts/ocr-eval): plain greyscale upscaled 2.5x read 89.9% of the
  // characters against 77.0% for the original image; 3.25x 90.9%. CLAHE (89.0%, and 97.5% -> 71.3% on one image)
  // and sharpening (89.3%) did not help on normal-contrast screenshots, so CLAHE is only used on low-contrast ones.
  const lowContrast = contrastSpread(px) < 80
  const prep = (scale: number): Promise<Raw> => prepare(px, { invert: inverted, scale, stretch: true, clahe: lowContrast ? TARGET_TEXT_PX * 5 : undefined })
  const fit = Math.sqrt(MAX_SCALED_PIXELS / Math.max(1, W * H))
  debug(`decoded ${W}x${H}, ${inverted ? 'dark (inverted)' : 'light'}${lowContrast ? ', low contrast' : ''}, engine max ${info.maxDim}`)
  // 1. reading A at 2.5x, then the text height decides: very small or very large text is read again at the scale
  // that brings it to about TARGET_TEXT_PX
  let s = Math.round(Math.min(2.5, fit) * 100) / 100
  let a = await run(await prep(s), s, 160)
  const h1 = median(a.map((w) => w.h))
  const want = chooseScale(h1, W, H)
  if (a.length && Math.abs(want - s) / s > 0.3) {
    s = want
    a = await run(await prep(s), s, Math.round(Math.max(160, 3 * Math.max(...a.map((w) => w.h)) * s)))
  }
  const overlap = Math.round(Math.max(160, 3 * Math.max(0, ...a.map((w) => w.h)) * s))
  const base = await prepare(px, { invert: inverted, scale: 1, stretch: true })
  let words = a
  const unclear: Box[] = []
  if (o.verify !== false && a.length) {
    // 2. reading B at a different scale: the engine's mistakes change with the pixel grid, the real text does not
    const sb = Math.round((s * 1.3 <= Math.min(MAX_SCALE * 1.15, fit) ? s * 1.3 : s / 1.3) * 100) / 100
    const b = await run(await prep(sb), sb, Math.round((overlap * sb) / s))
    const cmp = compareReadings(a, b)
    words = cmp.agreed
    if (cmp.disputes.length) {
      // 4. reading C of the disputed regions only, padded to give the engine context, larger again
      const th = Math.max(8, h1 || 12)
      const regions = cmp.disputes.map((d) => ({ x: Math.max(0, d.box.x - th), y: Math.max(0, d.box.y - th * 0.4), w: Math.min(W, d.box.w + 2 * th), h: Math.min(H, d.box.h + th * 0.8) }))
      // 3. reading C of the disputed regions only, larger again, all stacked into one strip
      const c = await readStrips(e, base, regions, Math.min(MAX_SCALE * 1.25, s * 1.6), maxTile, o.signal)
      passes++
      const r = resolveDisputes(cmp.disputes, c)
      debug(`disputes ${cmp.disputes.length}: ${cmp.disputes.map((d) => `${d.a}|${d.b}`).join('; ')} -> C: ${c.map((w) => w.t).join(' ')}; unclear ${r.unclear.length}`)
      words = [...words, ...r.words]
      unclear.push(...r.unclear)
    }
  }
  const lines = groupLines(words)
  for (const u of mergeBoxes(unclear)) lines.push({ ...u, text: '', words: [], unclear: true })
  lines.sort((p, q) => p.y - q.y || p.x - q.x)
  return { width: W / px.scale, height: H / px.scale, lines: px.scale === 1 ? lines : lines.map((l) => scaleLine(l, 1 / px.scale)), textHeight: median(words.map((w) => w.h)) / px.scale, scale: s, inverted, passes, tiles, lang: info.lang, ms: Date.now() - t0, px }
}

function scaleLine(l: OcrLine, k: number): OcrLine {
  const b = (x: { x: number; y: number; w: number; h: number }) => ({ x: x.x * k, y: x.y * k, w: x.w * k, h: x.h * k })
  return { ...l, ...b(l), words: l.words.map((w) => ({ ...w, ...b(w) })) }
}

/** Overlapping unclear boxes become one. */
function mergeBoxes(boxes: Box[]): Box[] {
  const out: Box[] = []
  for (const b of boxes) {
    const hit = out.findIndex((o) => !(b.x > o.x + o.w || o.x > b.x + b.w || b.y > o.y + o.h || o.y > b.y + b.h))
    if (hit >= 0) out[hit] = union([out[hit], b])
    else out.push(b)
  }
  return out
}

/** Read many small regions by stacking them into strips that fit the engine's size limit. */
async function readStrips(e: OcrEngineFns, base: Raw, regions: Box[], scale: number, maxTile: number, signal?: AbortSignal): Promise<OcrWord[]> {
  const out: OcrWord[] = []
  let batch: Box[] = []
  let height = 0
  const flush = async (): Promise<void> => {
    if (!batch.length) return
    const k = Math.min(scale, (maxTile - 60) / Math.max(...batch.map((r) => r.w)))
    const { file, placed } = await writeStrip(base, batch, k)
    batch = []
    height = 0
    if (signal?.aborted) throw new Error('cancelled')
    try {
      const r = await e.recognize(file)
      for (const w of r.lines.flat()) {
        const cy = w.y + w.h / 2
        const p = placed.find((q) => cy >= q.y && cy <= q.y + q.h)
        if (p) out.push({ t: w.t, x: p.region.x + (w.x - 24) / k, y: p.region.y + (w.y - p.y) / k, w: w.w / k, h: w.h / k })
      }
    } finally {
      void removeQuietly(file)
    }
  }
  for (const r of regions) {
    const h = r.h * scale + 24
    if (height + h > maxTile - 48) await flush()
    batch.push(r)
    height += h
  }
  await flush()
  return out
}
