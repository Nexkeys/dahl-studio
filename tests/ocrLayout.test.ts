import { describe, expect, it } from 'vitest'
import { buildLayout } from '../src/main/ocr/layout'
import { contrast, type RgbImage } from '../src/main/ocr/colors'
import type { OcrLine } from '../src/main/ocr/geometry'

/** A synthetic OCR line: words laid out left to right with character widths of about half the height. */
function line(text: string, x: number, y: number, h = 14): OcrLine {
  let cx = x
  const words = text.split(' ').map((t) => {
    const wd = Math.round(t.length * h * 0.55)
    const word = { t, x: cx, y, w: wd, h }
    cx += wd + Math.round(h * 0.3)
    return word
  })
  return { x, y, w: cx - Math.round(h * 0.3) - x, h, text, words }
}
const order = (lines: OcrLine[]): string[] => buildLayout({ width: 1000, height: 700, lines }).readingText.split('\n')

describe('layout from OCR boxes', () => {
  it('reads a sidebar before the main content', () => {
    const lines = [line('Acme Analytics', 20, 20, 16), line('Overview', 20, 70), line('Revenue', 20, 100), line('Settings', 20, 130),
      line('Overview for March 2026', 220, 20, 22), line('Revenue grew by twelve percent this month', 220, 70), line('Three invoices are overdue', 220, 92)]
    expect(order(lines)).toEqual(['Acme Analytics', 'Overview', 'Revenue', 'Settings', 'Overview for March 2026', 'Revenue grew by twelve percent this month\nThree invoices are overdue'].join('\n').split('\n'))
  })

  it('reads a title, then the left column, then the right column', () => {
    const lines = [line('Why local first software matters for every team', 50, 20, 26)]
    for (let i = 0; i < 4; i++) lines.push(line(`left column line ${i + 1} of running text`, 50, 80 + i * 20))
    for (let i = 0; i < 4; i++) lines.push(line(`right column line ${i + 1} of running text`, 520, 80 + i * 20))
    const got = order(lines)
    expect(got[0]).toMatch(/^Why local/)
    expect(got.slice(1, 5).every((l) => l.startsWith('left'))).toBe(true)
    expect(got.slice(5).every((l) => l.startsWith('right'))).toBe(true)
  })

  it('finds a table and reads it row by row, with the title before and the note after', () => {
    const rows = [['Region', 'Q1', 'Q2', 'Total'], ['North', '12,400', '13,950', '26,350'], ['Europe', '9,870', '10,240', '20,110'], ['Asia', '7,315', '8,060', '15,375']]
    const lines = [line('Quarterly sales', 28, 20, 20)]
    rows.forEach((r, i) => r.forEach((c, k) => lines.push(line(c, 30 + k * 160, 70 + i * 34))))
    lines.push(line('Figures in thousands', 28, 220))
    const l = buildLayout({ width: 1000, height: 700, lines })
    expect(l.grids).toHaveLength(1)
    expect(l.grids[0].map((r) => r.map((c) => c.text))).toEqual(rows)
    expect(l.readingText.split('\n')).toEqual(['Quarterly sales', ...rows.flat(), 'Figures in thousands'])
  })

  it('reads side-by-side cards one by one (mixed sizes are not a table)', () => {
    const lines = [line('Overview', 20, 10, 22)]
    const cards = [['Monthly revenue', '$48,213'], ['Active customers', '1,284'], ['Open invoices', '37']]
    cards.forEach(([label, value], k) => {
      lines.push(line(label, 20 + k * 260, 60, 12))
      lines.push(line(value, 20 + k * 260, 84, 26))
    })
    const l = buildLayout({ width: 1000, height: 700, lines })
    expect(l.grids).toHaveLength(0)
    expect(l.readingText.split('\n')).toEqual(['Overview', ...cards.flat()])
  })

  it('groups text sizes into tiers and marks large short text as a heading', () => {
    const l = buildLayout({ width: 1000, height: 700, lines: [line('Settings', 20, 10, 28), line('Email notifications', 20, 70), line('Receive a summary every morning', 20, 100, 11)] })
    expect(l.tiers.map((t) => t.size)).toEqual([28, 14, 11])
    expect(l.blocks[0]).toMatchObject({ kind: 'heading', tier: 1 })
  })
})

/** a white RGB canvas with filled rectangles */
function canvas(W: number, H: number, rects: [number, number, number, number, [number, number, number]][]): RgbImage {
  const data = Buffer.alloc(W * H * 3, 255)
  for (const [x, y, w, h, c] of rects)
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) data.set(c, (yy * W + xx) * 3)
  return { data, width: W, height: H, channels: 3, scale: 1 }
}

describe('colours and UI elements', () => {
  it('finds a button, a link and a text field, with colours and contrast', () => {
    const grey: [number, number, number] = [208, 215, 222]
    const px = canvas(400, 260, [
      [50, 40, 120, 40, [31, 136, 61]], [70, 57, 40, 4, [255, 255, 255]], // green button with (a stroke of) white text
      [50, 104, 70, 5, [9, 105, 218]], // blue link text
      [40, 150, 320, 1, grey], [40, 180, 320, 1, grey], [40, 150, 1, 31, grey], [360, 150, 1, 31, grey], [52, 163, 30, 4, [101, 109, 118]] // text field
    ])
    const l = buildLayout({ width: 400, height: 260, px, lines: [line('Sign in', 70, 52), line('Forgot password', 50, 100), line('jane', 52, 158)] })
    const byText = Object.fromEntries(l.blocks.map((b) => [b.text, b]))
    expect(byText['Sign in']).toMatchObject({ kind: 'button', bg: '#1f883d', fg: '#ffffff' })
    expect(byText['Sign in'].contrast).toBeCloseTo(contrast('#ffffff', '#1f883d'), 1)
    expect(byText['Forgot password'].kind).toBe('link')
    expect(byText['jane'].kind).toBe('input')
  })
  it('computes the WCAG contrast ratio', () => {
    expect(contrast('#000000', '#ffffff')).toBe(21)
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.5, 1)
  })
})
