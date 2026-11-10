import { describe, expect, it } from 'vitest'
import { groupLines, mergeTiles, tileGrid, toOriginal, type OcrWord } from '../src/main/ocr/geometry'
import { compareReadings, resolveDisputes } from '../src/main/ocr/consensus'
import { chooseScale } from '../src/main/ocr/pipeline'

const w = (t: string, x: number, y: number, ww = t.length * 10, h = 20): OcrWord => ({ t, x, y, w: ww, h })

describe('tiling math', () => {
  it('keeps an image that fits in one tile', () => {
    expect(tileGrid(1000, 800, 4096, 160)).toEqual([{ x: 0, y: 0, w: 1000, h: 800 }])
  })
  it('splits into evenly spread tiles that overlap and end at the edge', () => {
    const t = tileGrid(10000, 3000, 4096, 200)
    expect(t).toHaveLength(3)
    expect(t[0].x).toBe(0)
    expect(t[2].x + t[2].w).toBe(10000)
    for (const tile of t) expect(tile.w).toBeLessThanOrEqual(4096)
    // every neighbour pair overlaps by at least the requested overlap
    for (let i = 0; i + 1 < t.length; i++) expect(t[i].x + t[i].w - t[i + 1].x).toBeGreaterThanOrEqual(200)
  })
  it('tiles both directions', () => {
    const t = tileGrid(5000, 9000, 4096, 160)
    expect(t).toHaveLength(2 * 3)
    expect(Math.max(...t.map((b) => b.y + b.h))).toBe(9000)
  })
})

describe('merging tiles without duplicates', () => {
  it('keeps the complete copy of a word read in two overlapping tiles', () => {
    const left = { x: 0, y: 0, w: 1100, h: 500 }
    const right = { x: 900, y: 0, w: 1100, h: 500 }
    // "Settings" sits across the cut at x=1100: the left tile saw a cut-off "Sett", the right tile the whole word
    const merged = mergeTiles([
      { tile: left, words: [w('Hello', 100, 50), w('Sett', 1060, 50, 40)] },
      { tile: right, words: [w('Settings', 1060, 50, 80), w('World', 1500, 50)] }
    ], 2000, 500)
    expect(merged.map((x) => x.t).sort()).toEqual(['Hello', 'Settings', 'World'])
  })
  it('keeps one copy of a word read fully by both tiles', () => {
    const merged = mergeTiles([
      { tile: { x: 0, y: 0, w: 1100, h: 500 }, words: [w('Profile', 950, 200)] },
      { tile: { x: 900, y: 0, w: 1100, h: 500 }, words: [w('Profile', 951, 201)] }
    ], 2000, 500)
    expect(merged).toHaveLength(1)
  })
  it('maps scaled words back to original pixels', () => {
    expect(toOriginal([w('a', 100, 50, 40, 30)], 2.5)[0]).toEqual({ t: 'a', x: 40, y: 20, w: 16, h: 12 })
  })
})

describe('grouping words into lines', () => {
  it('joins words on one row and splits at wide gaps (columns)', () => {
    const lines = groupLines([w('Left', 0, 0), w('column', 50, 2), w('Right', 400, 1), w('side', 460, 0), w('Next', 0, 40)])
    expect(lines.map((l) => l.text)).toEqual(['Left column', 'Right side', 'Next'])
  })
})

describe('confidence by agreement', () => {
  it('trusts what both readings agree on, even when split into words differently', () => {
    const c = compareReadings([w('Sign', 0, 0), w('in', 50, 0), w('Cancel', 200, 0)], [w('Signin', 0, 0, 70), w('Cance1', 200, 0)])
    expect(c.agreed.map((x) => x.t)).toEqual(['Sign', 'in'])
    expect(c.disputes).toHaveLength(1)
    expect(c.disputes[0]).toMatchObject({ a: 'Cancel', b: 'Cance1' })
  })
  it('a third reading settles a dispute, otherwise the region is unclear (never guessed)', () => {
    const { disputes } = compareReadings([w('Cancel', 200, 0), w('Totol', 0, 100)], [w('Cance1', 200, 0), w('Tota1', 0, 100)])
    const r = resolveDisputes(disputes, [w('Cancel', 201, 1), w('T0ta', 0, 100)])
    expect(r.words.map((x) => x.t)).toEqual(['Cancel'])
    expect(r.unclear).toHaveLength(1)
    expect(r.unclear[0].y).toBe(100)
  })
  it('drops a short mark only one reading saw (an icon), but reports longer text seen once as unclear', () => {
    const { disputes } = compareReadings([w('@', 0, 0, 10), w('Upgrade', 0, 100)], [])
    const r = resolveDisputes(disputes, [])
    expect(r.words).toHaveLength(0)
    expect(r.unclear).toHaveLength(1)
  })
})

describe('scale choice', () => {
  it('brings text to about 30 px, never below 1x for normal text, within the pixel budget', () => {
    expect(chooseScale(12, 1000, 600)).toBe(2.5)
    expect(chooseScale(6, 1000, 600)).toBe(4)
    expect(chooseScale(40, 1000, 600)).toBe(1)
    expect(chooseScale(10, 8000, 6000)).toBeLessThan(1)
  })
})
