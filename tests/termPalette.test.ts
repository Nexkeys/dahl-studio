import { describe, expect, it } from 'vitest'
import { THEMES } from '../src/renderer/src/themes'
import { ANSI_KEYS, colorsFromVars, DIM_CONTRAST, MIN_CONTRAST, terminalTheme } from '../src/renderer/src/terminal/palette'
import { contrast, ensureContrast, hueDistance, parseColor, rgbToHsl, toHex, type Rgb } from '../src/renderer/src/terminal/color'

const c = (hex: string | undefined): Rgb => {
  const v = hex && parseColor(hex)
  if (!v) throw new Error(`not a colour: ${hex}`)
  return v
}

describe('colour helpers', () => {
  it('parses hex and rgb() forms and measures WCAG contrast', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('#1f6f4a80')).toEqual({ r: 31, g: 111, b: 74 })
    expect(parseColor('rgba(7, 11, 7, 0.92)')).toEqual({ r: 7, g: 11, b: 7 })
    expect(parseColor('var(--x)')).toBeNull()
    expect(contrast(c('#000'), c('#fff'))).toBeCloseTo(21, 5)
    expect(toHex(c('#AbCdEf'))).toBe('#abcdef')
  })

  it('ensureContrast keeps the hue and reaches the target in both directions', () => {
    const blue = c('#0037da')
    const onDark = ensureContrast(blue, c('#0c0c0c'), 4.5)
    const onLight = ensureContrast(c('#f9f1a5'), c('#ffffff'), 4.5)
    expect(contrast(onDark, c('#0c0c0c'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(onLight, c('#ffffff'))).toBeGreaterThanOrEqual(4.5)
    expect(hueDistance(rgbToHsl(onDark).h, rgbToHsl(blue).h)).toBeLessThan(4)
  })
})

describe('terminal palette for every Dahl theme', () => {
  const HUE: Record<string, number> = { red: 0, yellow: 48, green: 125, cyan: 185, blue: 218, magenta: 300 }

  for (const t of THEMES) {
    it(`${t.name} (${t.dark ? 'dark' : 'light'}): all 16 colours readable, hues recognisable`, () => {
      const th = terminalTheme(colorsFromVars(t.vars), t.dark)
      const bg = c(th.background)
      expect(th.background).toBe(toHex(c(t.vars['--editor-bg'])))
      expect(th.foreground).toBe(toHex(c(t.vars['--text'])))
      for (const k of ANSI_KEYS) expect(parseColor(th[k] ?? ''), k).not.toBeNull()
      for (const slot of Object.keys(HUE)) {
        const bright = `bright${slot[0].toUpperCase()}${slot.slice(1)}` as (typeof ANSI_KEYS)[number]
        for (const k of [slot, bright] as const) {
          const col = c(th[k as keyof typeof th] as string)
          expect(contrast(col, bg), `${k} contrast`).toBeGreaterThanOrEqual(MIN_CONTRAST - 0.01)
          expect(hueDistance(rgbToHsl(col).h, HUE[slot]), `${k} hue`).toBeLessThanOrEqual(34)
        }
        expect(th[bright], `${bright} differs from ${slot}`).not.toBe(th[slot as keyof typeof th])
      }
      for (const k of ['white', 'brightWhite'] as const) expect(contrast(c(th[k]), bg), k).toBeGreaterThanOrEqual(MIN_CONTRAST - 0.01)
      expect(contrast(c(th.brightBlack), bg)).toBeGreaterThanOrEqual(DIM_CONTRAST)
      if (!t.dark) expect(contrast(c(th.black), bg)).toBeGreaterThanOrEqual(MIN_CONTRAST - 0.01)
      expect(contrast(c(th.cursor), bg)).toBeGreaterThanOrEqual(DIM_CONTRAST - 0.01)
      expect(contrast(c(th.selectionBackground), bg)).toBeGreaterThan(1.05)
    })
  }

  it('re-derives when the theme changes (dark and light differ)', () => {
    const dark = THEMES.find((t) => t.dark)!
    const light = THEMES.find((t) => !t.dark)!
    expect(terminalTheme(colorsFromVars(dark.vars), true).background).not.toBe(terminalTheme(colorsFromVars(light.vars), false).background)
  })
})
