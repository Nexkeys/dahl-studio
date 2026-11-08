import type { Box } from './geometry'

/** Colour sampling on raw RGB pixels: palette, text and background colour of a region, WCAG contrast ratio. */

export interface RgbImage {
  data: Buffer
  width: number
  height: number
  channels: number
  /** pixels per original-image pixel */
  scale: number
}

export const hex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
export const fromHex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]

/** WCAG relative luminance (0..1) */
export function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number): number => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(fromHex(a)), luminance(fromHex(b))].sort((p, q) => q - p)
  return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10
}
export const dist = (a: string, b: string): number => {
  const [p, q] = [fromHex(a), fromHex(b)]
  return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])
}

type Bucket = { r: number; g: number; b: number; n: number }
function buckets(img: RgbImage, box: Box | null, step = 1): Bucket[] {
  const k = img.scale
  const x0 = box ? Math.max(0, Math.floor(box.x * k)) : 0
  const y0 = box ? Math.max(0, Math.floor(box.y * k)) : 0
  const x1 = box ? Math.min(img.width, Math.ceil((box.x + box.w) * k)) : img.width
  const y1 = box ? Math.min(img.height, Math.ceil((box.y + box.h) * k)) : img.height
  const m = new Map<number, Bucket>()
  for (let y = y0; y < y1; y += step)
    for (let x = x0; x < x1; x += step) {
      const o = (y * img.width + x) * img.channels
      const r = img.data[o], g = img.data[o + 1], b = img.data[o + 2]
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const e = m.get(key)
      if (e) (e.r += r), (e.g += g), (e.b += b), e.n++
      else m.set(key, { r, g, b, n: 1 })
    }
  return [...m.values()].sort((p, q) => q.n - p.n)
}
const avg = (b: Bucket): string => hex(b.r / b.n, b.g / b.n, b.b / b.n)

/** The most common colours of the whole image (up to 10), with their share in percent. */
export function palette(img: RgbImage, max = 10): { hex: string; pct: number }[] {
  const step = Math.max(1, Math.round(Math.sqrt((img.width * img.height) / 250_000)))
  const all = buckets(img, null, step)
  const total = all.reduce((a, b) => a + b.n, 0) || 1
  return all.slice(0, max).map((b) => ({ hex: avg(b), pct: Math.round((b.n * 1000) / total) / 10 }))
}

/**
 * Background = the most common colour in the box; text = the most common colour clearly different from it
 * (anti-aliased edge pixels sit between the two and are skipped by the distance threshold).
 */
export function regionColours(img: RgbImage, box: Box): { fg: string; bg: string; contrast: number } | null {
  const bs = buckets(img, box)
  if (!bs.length) return null
  const bg = avg(bs[0])
  const fgB = bs.slice(1).filter((b) => dist(avg(b), bg) > 90)
  const fgBucket = fgB.sort((p, q) => q.n * dist(avg(q), bg) - p.n * dist(avg(p), bg))[0]
  const fg = fgBucket ? avg(fgBucket) : bg
  return { fg, bg, contrast: contrast(fg, bg) }
}

/** Dominant colour of a thin ring around a box (what the box sits on). */
export function ringColour(img: RgbImage, box: Box, pad: number): string | null {
  const parts: Box[] = [
    { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: pad * 0.6 },
    { x: box.x - pad, y: box.y + box.h + pad * 0.4, w: box.w + 2 * pad, h: pad * 0.6 },
    { x: box.x - pad, y: box.y, w: pad * 0.6, h: box.h },
    { x: box.x + box.w + pad * 0.4, y: box.y, w: pad * 0.6, h: box.h }
  ]
  const m = new Map<string, number>()
  for (const p of parts) for (const b of buckets(img, p).slice(0, 3)) m.set(avg(b), (m.get(avg(b)) ?? 0) + b.n)
  const top = [...m.entries()].sort((p, q) => q[1] - p[1])[0]
  return top ? top[0] : null
}

/** Is the colour clearly saturated (a link or accent colour rather than grey text)? */
export function saturated(h: string): boolean {
  const [r, g, b] = fromHex(h)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  return mx - mn > 60 && mx > 70
}
