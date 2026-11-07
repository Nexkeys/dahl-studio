import sharp from 'sharp'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Box } from './geometry'

/** Image preprocessing for OCR with sharp (libvips): greyscale, dark-mode inversion, contrast, scaling, crops. */

sharp.cache(false) // every image is processed once; libvips' operation cache would only hold memory

export interface Raw {
  data: Buffer
  width: number
  height: number
  channels: number
}

/** Decoded RGB pixels (EXIF rotation applied, transparency flattened onto white), downscaled to at most `max` px. */
export async function rgbPixels(input: Buffer, max = 4000): Promise<Raw & { scale: number }> {
  const meta = await sharp(input, { limitInputPixels: 268_000_000 }).rotate().metadata()
  const W = meta.autoOrient?.width ?? meta.width ?? 1
  const H = meta.autoOrient?.height ?? meta.height ?? 1
  const scale = Math.min(1, max / Math.max(W, H))
  let img = sharp(input, { limitInputPixels: 268_000_000 }).rotate().flatten({ background: '#ffffff' })
  if (scale < 1) img = img.resize(Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale)), { kernel: 'lanczos3' })
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels, scale }
}

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * Dark mode: the most common luminance (the background) is dark, or more than half the image is dark.
 * Such screenshots are inverted before OCR, which reads dark text on a light background best.
 */
export function isDark(px: Raw): boolean {
  const bins = new Array(16).fill(0)
  let dark = 0
  const step = Math.max(1, Math.floor((px.width * px.height) / 200_000))
  let n = 0
  for (let i = 0; i < px.width * px.height; i += step) {
    const o = i * px.channels
    const l = lum(px.data[o], px.data[o + 1], px.data[o + 2])
    bins[Math.min(15, Math.floor(l / 16))]++
    if (l < 100) dark++
    n++
  }
  const mode = bins.indexOf(Math.max(...bins))
  return mode * 16 + 8 < 100 || dark / Math.max(1, n) > 0.5
}

export interface PrepOptions {
  /** invert (white text on dark backgrounds becomes dark on light) */
  invert: boolean
  /** scale factor applied to the original size */
  scale: number
  /** local contrast equalisation (CLAHE), with a window sized to the expected text height */
  clahe?: number
  sharpen?: boolean
}

/** Greyscale, optionally inverted, contrast-stretched and scaled: the image OCR actually reads. */
export async function prepare(px: Raw, o: PrepOptions): Promise<Raw> {
  const w = Math.max(1, Math.round(px.width * o.scale))
  const h = Math.max(1, Math.round(px.height * o.scale))
  let img = sharp(px.data, { raw: { width: px.width, height: px.height, channels: px.channels as 3 } }).greyscale()
  if (o.invert) img = img.negate()
  img = img.normalise({ lower: 1, upper: 99 })
  if (o.scale !== 1) img = img.resize(w, h, { kernel: o.scale > 1 ? 'lanczos3' : 'mitchell' })
  if (o.clahe) {
    const win = Math.max(8, Math.round(o.clahe))
    img = img.clahe({ width: win, height: win, maxSlope: 3 })
  }
  if (o.sharpen) img = img.sharpen({ sigma: 0.8 })
  const { data, info } = await img.toColourspace('b-w').raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

const tmpPath = (): string => path.join(os.tmpdir(), `dahl-ocr-${randomBytes(6).toString('hex')}.png`)

/** Write a region of a prepared image as a PNG for the OCR engine; returns the temporary file path. */
export async function writeRegion(img: Raw, region?: Box): Promise<string> {
  const file = tmpPath()
  let s = sharp(img.data, { raw: { width: img.width, height: img.height, channels: img.channels as 1 } })
  if (region) s = s.extract({ left: Math.round(region.x), top: Math.round(region.y), width: Math.round(region.w), height: Math.round(region.h) })
  await s.png({ compressionLevel: 1 }).toFile(file)
  return file
}

/**
 * Stack several regions of one image into a single strip (white gaps between them), so a second reading of many
 * small uncertain regions costs one OCR call. Returns the strip file and where each region landed in it.
 */
export async function writeStrip(img: Raw, regions: Box[], scale: number, gap = 24): Promise<{ file: string; placed: { region: Box; y: number; h: number; w: number }[] }> {
  const crops: { region: Box; buf: Buffer; w: number; h: number }[] = []
  for (const r of regions) {
    const left = Math.max(0, Math.floor(r.x)), top = Math.max(0, Math.floor(r.y))
    const width = Math.min(img.width - left, Math.ceil(r.w)), height = Math.min(img.height - top, Math.ceil(r.h))
    if (width < 2 || height < 2) continue
    const w = Math.round(width * scale), h = Math.round(height * scale)
    const buf = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: img.channels as 1 } })
      .extract({ left, top, width, height }).resize(w, h, { kernel: 'lanczos3' }).toColourspace('b-w').raw().toBuffer()
    crops.push({ region: { x: left, y: top, w: width, h: height }, buf, w, h })
  }
  const W = Math.max(1, ...crops.map((c) => c.w)) + 2 * gap
  let y = gap
  const placed = crops.map((c) => {
    const p = { region: c.region, y, h: c.h, w: c.w }
    y += c.h + gap
    return p
  })
  const H = Math.max(y, 2 * gap)
  const strip = Buffer.alloc(W * H, 255)
  crops.forEach((c, i) => {
    for (let row = 0; row < c.h; row++) c.buf.copy(strip, (placed[i].y + row) * W + gap, row * c.w, (row + 1) * c.w)
  })
  const file = tmpPath()
  await sharp(strip, { raw: { width: W, height: H, channels: 1 } }).png({ compressionLevel: 1 }).toFile(file)
  return { file, placed }
}

export async function removeQuietly(file: string): Promise<void> {
  await fs.rm(file, { force: true }).catch(() => {})
}
