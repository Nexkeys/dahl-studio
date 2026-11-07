import { describe, it, expect } from 'vitest'
import { THEMES, type Theme } from '../src/renderer/src/themes'
import { contrast, deltaE } from '../src/renderer/src/color'
import { targets } from '../src/renderer/src/themegen'

// Every theme must meet WCAG 2.2 AA (High Contrast: AAA for text) and no two themes may look alike.

/** Foreground/background pairs the UI actually draws, with the contrast each needs. */
export function contrastChecks(t: Theme): { what: string; fg: string; bg: string; need: number }[] {
  const p = t.palette
  const T = targets(p.group)
  const out: { what: string; fg: string; bg: string; need: number }[] = []
  const add = (what: string, fg: string, bgs: Record<string, string>, need: number): void => {
    for (const [name, bg] of Object.entries(bgs)) out.push({ what: `${what} on ${name}`, fg, bg, need })
  }
  const panels = { bg: p.bg, surface: p.surface, editor: p.editorBg, chrome: p.chrome }
  add('text', p.text, { ...panels, 'surface-2': p.surface2, 'accent-soft': p.accentSoft, selection: p.selection, 'line-hl': p.lineHl, 'add-bg': p.addBg, 'del-bg': p.delBg }, T.text)
  add('muted text', p.muted, panels, T.muted)
  add('muted icon', p.muted, { 'surface-2': p.surface2, 'accent-soft': p.accentSoft }, 3)
  add('accent text', p.accent, { ...panels, 'accent-soft': p.accentSoft }, T.accent)
  add('button text', p.accentText, { accent: p.accent }, T.text)
  add('active rail icon', p.railOnText, { 'rail-on': p.railOn }, T.ui)
  add('tab indicator', p.tabIndicator, { surface: p.surface, editor: p.editorBg }, T.ui)
  add('control border', p.borderStrong, { bg: p.bg, surface: p.surface, editor: p.editorBg }, T.ui)
  for (const s of ['danger', 'warn', 'ok'] as const) {
    add(`${s} text`, p[s], panels, T.text)
    add(`${s} status glyph`, p[s], { 'surface-2': p.surface2, 'accent-soft': p.accentSoft, selection: p.selection }, 3)
  }
  for (const [k, c] of Object.entries(p.syn)) add(`syntax ${k}`, c, { editor: p.editorBg, 'line-hl': p.lineHl }, T.text)
  return out
}

describe('theme contrast (WCAG 2.2)', () => {
  it('has 13 themes, one of them high contrast', () => {
    expect(THEMES).toHaveLength(13)
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(13)
    expect(THEMES.filter((t) => t.group === 'contrast').map((t) => t.id)).toEqual(['high-contrast'])
  })

  for (const t of THEMES)
    it(`${t.name}: body text 4.5:1, muted text, borders and icons 3:1 or more`, () => {
      const fails = contrastChecks(t).map((c) => ({ ...c, got: contrast(c.fg, c.bg) })).filter((c) => c.got < c.need)
      expect(fails.map((f) => `${f.what}: ${f.got.toFixed(2)} < ${f.need}`)).toEqual([])
    })

  it('dividers stay visible (decorative separators, 1.1:1 or more against the panel)', () => {
    for (const t of THEMES) expect(contrast(t.palette.border, t.palette.surface), t.id).toBeGreaterThanOrEqual(1.1)
  })
})

// Distinctness. Colour: OKLab distance (deltaE), where about 0.02 is one just-noticeable difference (CSS Color 4
// deltaEOK). Two themes must differ by at least 0.05 (2.5 JND, plainly visible side by side) on at least two of the
// three colours that cover the most screen or carry the identity: app background, panel surface, accent.
// Structure: at least 3 of the 11 structural axes must differ, so no theme is a recolour of another.
export const COLOUR_MIN = 0.05
export const STRUCT_MIN = 3

const radiusClass = (r: number): string => (r <= 3 ? 'sharp' : r <= 7 ? 'small' : r <= 11 ? 'medium' : 'round')
const family = (stack: string): string => stack.split(',')[0].replace(/'/g, '').trim()

export function structuralAxes(t: Theme): Record<string, string> {
  const s = t.structure
  return {
    surfaces: s.surfaces, separation: s.separation, radius: radiusClass(s.radius), density: s.density, font: family(s.font), headFont: family(s.headFont),
    labels: s.labels, iconStroke: String(s.iconStroke), chrome: s.chrome, motion: s.motion, effect: t.effect
  }
}

export function distance(a: Theme, b: Theme): { colour: number[]; colourPass: number; struct: number } {
  const colour = [deltaE(a.palette.bg, b.palette.bg), deltaE(a.palette.surface, b.palette.surface), deltaE(a.palette.accent, b.palette.accent)]
  const sa = structuralAxes(a), sb = structuralAxes(b)
  return { colour, colourPass: colour.filter((d) => d >= COLOUR_MIN).length, struct: Object.keys(sa).filter((k) => sa[k] !== sb[k]).length }
}

describe('theme distinctness', () => {
  it(`every pair differs on 2 of bg/surface/accent by deltaE ${COLOUR_MIN}+ and on ${STRUCT_MIN}+ structural axes`, () => {
    const fails: string[] = []
    let closest = { pair: '', struct: 99, colour: 99 }
    for (let i = 0; i < THEMES.length; i++)
      for (let j = i + 1; j < THEMES.length; j++) {
        const a = THEMES[i], b = THEMES[j], d = distance(a, b)
        const second = [...d.colour].sort((x, y) => y - x)[1]
        if (d.colourPass < 2 || d.struct < STRUCT_MIN) fails.push(`${a.id} / ${b.id}: colour ${d.colour.map((x) => x.toFixed(3)).join(' ')}, ${d.struct} axes`)
        if (d.struct < closest.struct || (d.struct === closest.struct && second < closest.colour)) closest = { pair: `${a.id} / ${b.id}`, struct: d.struct, colour: second }
      }
    console.log(`closest pair: ${closest.pair} (${closest.struct} structural axes differ, second-largest colour deltaE ${closest.colour.toFixed(3)})`)
    expect(fails).toEqual([])
  })

  it('light, dark and high contrast themes are grouped', () => {
    expect(THEMES.filter((t) => t.group === 'light').length).toBeGreaterThanOrEqual(4)
    for (const t of THEMES) expect(t.dark, t.id).toBe(t.group !== 'light')
  })
})
