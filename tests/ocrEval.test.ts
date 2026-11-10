import { afterAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { levenshtein } from '../src/main/ocr/geometry'
import { ocrImage } from '../src/main/ocr/pipeline'
import { buildLayout } from '../src/main/ocr/layout'
import { windowsOcrHelper } from '../src/main/ocr/windowsOcr'
import { baselineOcr } from '../scripts/ocr-eval/baseline'

/**
 * OCR accuracy on the evaluation screenshots (scripts/ocr-eval). Opt-in, like the live tests:
 *   $env:DAHL_OCR_EVAL="<folder with *-normal.png, *-small.png, *-dark.png, *-blurry.png and <page>.txt>"; npx vitest run tests/ocrEval.test.ts
 * Writes results.json into that folder. Character accuracy = 1 - edit distance / ground-truth length, on text with
 * whitespace collapsed; "order-free" sorts the words first, so it does not depend on reading order.
 */
const DIR = process.env.DAHL_OCR_EVAL
const norm = (s: string): string => s.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
const acc = (gt: string, got: string): number => Math.max(0, 1 - levenshtein(gt, got) / Math.max(1, gt.length))
const sorted = (s: string): string => s.split(' ').sort().join(' ')

describe.skipIf(!DIR)('OCR evaluation', () => {
  afterAll(() => windowsOcrHelper.kill())
  it('measures character accuracy before and after', async () => {
    const files = (await fs.readdir(DIR!)).filter((f) => f.endsWith('.png')).sort()
    const only = process.env.DAHL_OCR_EVAL_ONLY
    const rows: { file: string; before: number; after: number; beforeFree: number; afterFree: number; beforeMs: number; afterMs: number; unclear: number; passes: number }[] = []
    for (const f of files.filter((x) => !only || x.includes(only))) {
      const gt = norm(await fs.readFile(path.join(DIR!, f.replace(/-\w+\.png$/, '.txt')), 'utf8'))
      const abs = path.join(DIR!, f)
      let t = Date.now()
      const before = process.env.DAHL_OCR_EVAL_NOBASE ? '' : norm((await baselineOcr(abs)).map((l) => l.text).join('\n'))
      const beforeMs = Date.now() - t
      t = Date.now()
      const out = await ocrImage(await fs.readFile(abs))
      const layout = buildLayout(out)
      const after = norm(layout.readingText)
      const afterMs = Date.now() - t
      rows.push({ file: f, before: acc(gt, before), after: acc(gt, after), beforeFree: acc(sorted(gt), sorted(before)), afterFree: acc(sorted(gt), sorted(after)), beforeMs, afterMs, unclear: out.lines.filter((l) => l.unclear).length, passes: out.passes })
      const r = rows[rows.length - 1]
      console.log(`${f.padEnd(24)} before ${(r.before * 100).toFixed(1)}% (${(r.beforeFree * 100).toFixed(1)}%) ${beforeMs} ms | after ${(r.after * 100).toFixed(1)}% (${(r.afterFree * 100).toFixed(1)}%) ${afterMs} ms, ${r.unclear} unclear, ${r.passes} passes`)
      if (process.env.DAHL_OCR_EVAL_DUMP) console.log(`GT: ${gt}\nBEFORE: ${before}\nAFTER: ${after}\n`)
    }
    const mean = (k: keyof (typeof rows)[number]): number => rows.reduce((a, r) => a + (r[k] as number), 0) / Math.max(1, rows.length)
    const byVariant: Record<string, { before: number; after: number; n: number }> = {}
    for (const r of rows) {
      const v = /-(\w+)\.png$/.exec(r.file)![1]
      const b = (byVariant[v] ??= { before: 0, after: 0, n: 0 })
      b.before += r.before
      b.after += r.after
      b.n++
    }
    const summary = {
      images: rows.length, before: mean('before'), after: mean('after'), beforeOrderFree: mean('beforeFree'), afterOrderFree: mean('afterFree'), beforeMs: mean('beforeMs'), afterMs: mean('afterMs'),
      byVariant: Object.fromEntries(Object.entries(byVariant).map(([k, v]) => [k, { before: v.before / v.n, after: v.after / v.n, n: v.n }]))
    }
    console.log(JSON.stringify(summary, null, 2))
    await fs.writeFile(path.join(DIR!, only ? `results-${only}.json` : 'results.json'), JSON.stringify({ summary, rows }, null, 2))
    expect(rows.length).toBeGreaterThan(0)
  }, 1_800_000)
})
