import { afterAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { groupLines, levenshtein } from '../src/main/ocr/geometry'
import { windowsOcrHelper } from '../src/main/ocr/windowsOcr'

// TEMPORARY calibration experiment (not committed)
const DIR = process.env.DAHL_OCR_CALIB
const norm = (s: string): string => s.normalize('NFKC').replace(/\s+/g, ' ').trim()
const acc = (gt: string, got: string): number => Math.max(0, 1 - levenshtein(gt, got) / Math.max(1, gt.length))
const sorted = (s: string): string => s.split(' ').sort().join(' ')

const g = (s: sharp.Sharp, d: boolean): sharp.Sharp => (d ? s.greyscale().negate() : s.greyscale())
const configs: Record<string, (s: sharp.Sharp, w: number, dark: boolean) => sharp.Sharp> = {
  g25: (s, w, d) => g(s, d).resize(Math.round(w * 2.5), null, { kernel: 'lanczos3' }),
  g325: (s, w, d) => g(s, d).resize(Math.round(w * 3.25), null, { kernel: 'lanczos3' }),
  g25clahe: (s, w, d) => g(s, d).resize(Math.round(w * 2.5), null, { kernel: 'lanczos3' }).clahe({ width: 150, height: 150, maxSlope: 3 }),
  g25minmax: (s, w, d) => g(s, d).normalise({ lower: 0, upper: 100 }).resize(Math.round(w * 2.5), null, { kernel: 'lanczos3' }),
  g25sharp: (s, w, d) => g(s, d).resize(Math.round(w * 2.5), null, { kernel: 'lanczos3' }).sharpen({ sigma: 1 })
}

describe.skipIf(!DIR)('OCR calibration', () => {
  afterAll(() => windowsOcrHelper.kill())
  it('compares preprocessing configs', async () => {
    const only = (process.env.DAHL_OCR_CALIB_ONLY ?? '').split(',').filter(Boolean)
    const files = (await fs.readdir(DIR!)).filter((f) => f.endsWith('.png') && (!only.length || only.some((o) => f.includes(o)))).sort()
    const totals: Record<string, number[]> = {}
    for (const f of files) {
      const gt = sorted(norm(await fs.readFile(path.join(DIR!, f.replace(/-\w+\.png$/, '.txt')), 'utf8')))
      const abs = path.join(DIR!, f)
      const meta = await sharp(abs).metadata()
      const row: string[] = []
      for (const [name, fn] of Object.entries(configs)) {
        const out = path.join(DIR!, '..', 'scratch', `calib-${name}.png`)
        await fn(sharp(abs).flatten({ background: '#fff' }), meta.width!, f.includes('dark')).png().toFile(out)
        const r = await windowsOcrHelper.recognize(out)
        const text = groupLines(r.lines.flat()).map((l) => l.text).join(' ')
        const a = acc(gt, sorted(norm(text)))
        ;(totals[name] ??= []).push(a)
        row.push(`${name} ${(a * 100).toFixed(1)}`)
      }
      console.log(`${f}: ${row.join(' | ')}`)
    }
    console.log('MEAN ' + Object.entries(totals).map(([k, v]) => `${k} ${((v.reduce((a, b) => a + b, 0) / v.length) * 100).toFixed(1)}`).join(' | '))
    expect(files.length).toBeGreaterThan(0)
  }, 1_800_000)
})
