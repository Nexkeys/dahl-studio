import type { ThemeId } from '@shared/types'
import { away, contrast, fit, hexLch, mix, oklch, rgba, type Lch } from './color'

// Theme generator. A theme declares a few OKLCH inputs (background, accent, contrast, light or dark) and a structure
// (how surfaces separate, corners, density, type, icon weight, how much accent the chrome uses, motion). Every colour
// token is derived here and pushed to the contrast it needs, so all themes meet WCAG 2.2 AA by construction
// (tests/themes.test.ts checks it, plus that no two themes are too alike).

export type ThemeGroup = 'light' | 'dark' | 'contrast'
/** flat: one plane; elevated: stepped surfaces with shadows; islands: detached rounded panels with gaps; bordered: hard outlines; glass: translucent panels over the backdrop */
export type SurfaceStyle = 'flat' | 'elevated' | 'islands' | 'bordered' | 'glass'
/** dividers between panels: none (gaps do it), hairline, rule (strong, 3:1 or more), accent (accent-tinted lines) */
export type Separation = 'none' | 'hairline' | 'rule' | 'accent'
export type Density = 'compact' | 'regular' | 'roomy'
export type LabelStyle = 'normal' | 'upper' | 'mono'
/** how much accent the chrome (rail, tabs, headers) uses */
export type ChromeAccent = 'none' | 'subtle' | 'tinted' | 'strong'
export type Motion = 'none' | 'calm' | 'lively'

export interface Structure {
  surfaces: SurfaceStyle
  separation: Separation
  radius: number
  density: Density
  font: string
  headFont: string
  headWeight: number
  labels: LabelStyle
  /** icon stroke in CSS pixels at any icon size */
  iconStroke: number
  chrome: ChromeAccent
  motion: Motion
}

export interface Syn { keyword: string; string: string; number: string; comment: string; type: string; func: string; variable: string; punct: string }

export interface ThemeSpec {
  id: ThemeId
  name: string
  tagline: string
  group: ThemeGroup
  /** app background: lightness, neutral chroma and hue (every neutral is derived from it) */
  base: Lch
  accent: Lch
  /** 0 to 100: lightness steps between surfaces and how far text is pushed */
  contrast: number
  hues?: { danger?: number; warn?: number; ok?: number }
  /** seed colours: hue and chroma are kept, lightness is fitted to the editor background */
  syn: Syn
  structure: Structure
  mono?: string
  backdrop?: string
  effect?: string
  tracking?: string
}

export interface Palette {
  id: ThemeId; name: string; tagline: string; dark: boolean; group: ThemeGroup
  bg: string; surface: string; surface2: string; border: string; borderStrong: string; text: string; muted: string
  accent: string; accentText: string; accentSoft: string; danger: string; warn: string; ok: string
  selection: string; addBg: string; delBg: string; editorBg: string; lineHl: string
  /** header, top bar and rail background (accent-tinted in tinted and strong chrome) */
  chrome: string; railOn: string; railOnText: string; tabIndicator: string
  syn: Syn
  font: string; mono: string; radius: string; backdrop: string; glass: string; effect: string; tracking: string
  structure: Structure
}

/** Font stacks: only faces that ship with Windows 10 and 11 (Cascadia falls back to Consolas). */
export const FONTS = {
  text: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  display: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",
  mono: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  humanist: "'Sitka Text', Constantia, Georgia, serif",
  din: "Bahnschrift, 'Segoe UI', sans-serif",
  soft: "Candara, 'Segoe UI Variable Text', 'Segoe UI', sans-serif"
}

/** Minimum contrast per role. High contrast themes aim for WCAG AAA. */
export function targets(group: ThemeGroup): { text: number; muted: number; accent: number; ui: number } {
  return group === 'contrast' ? { text: 7, muted: 7, accent: 7, ui: 4.5 } : { text: 4.5, muted: 4.5, accent: 4.5, ui: 3 }
}

// surface lightness offsets in steps: [bg, surface, editor]; surface-2 (hover, chips) sits one step past surface
const PLAN: Record<SurfaceStyle, [number, number, number]> = {
  flat: [0, 0.3, 0], elevated: [0, 1, 0.6], islands: [-0.5, 1.7, 1.7], bordered: [0, 0, 0], glass: [0, 1.2, 0.6]
}

export function generate(s: ThemeSpec): Palette {
  const st = s.structure
  const T = targets(s.group)
  const dark = s.base.l < 0.5
  const k = s.contrast / 100
  const dir = dark ? 'up' : 'down'
  const step = (dark ? 0.02 : 0.016) + 0.03 * k
  const [pb, ps, pe] = PLAN[st.surfaces]
  const neutral = (l: number, cMul = 1): string => oklch(l, s.base.c * cMul, s.base.h)
  let bgL: number, surfL: number, s2L: number, edL: number
  if (dark) {
    bgL = s.base.l + pb * step
    surfL = s.base.l + ps * step
    s2L = surfL + 1.2 * step
    edL = s.base.l + pe * step
  } else {
    // light: raised surfaces are whiter, hover surfaces darker; flat and bordered themes keep one plane
    bgL = s.base.l + pb * step
    surfL = ps > 0.5 ? Math.min(0.995, s.base.l + ps * step * 2) : Math.min(1, s.base.l + ps * step)
    s2L = surfL - 1.2 * step
    edL = ps > 0.5 ? surfL : bgL
  }
  const light = !dark
  const bg = neutral(bgL), surface = neutral(surfL, light ? 0.4 : 1), surface2 = neutral(s2L, light ? 0.6 : 1), editorBg = neutral(edL, light ? 0.4 : 1)
  const lineHl = neutral(edL + (dark ? 0.6 : -0.45) * step, light ? 0.6 : 1)
  const surfaces = [bg, surface, surface2, editorBg, lineHl]

  const text = fit({ l: dark ? 0.92 + 0.06 * k : 0.25 - 0.1 * k, c: Math.min(s.base.c, 0.025) * 0.7, h: s.base.h }, surfaces, T.text, dir)
  const muted = fit({ l: dark ? 0.66 : 0.52, c: Math.min(s.base.c * 1.3 + 0.008, 0.06), h: s.base.h }, surfaces, T.muted, dir)
  const accent = fit(s.accent, [bg, surface, editorBg], T.accent, dir)

  // tints: as much accent as the text and the accent itself still allow
  const tint = (base: string, toward: string, t0: number, need: [string, number][]): string => {
    for (let t = t0; t > 0.01; t -= 0.015) {
      const c = mix(base, toward, t)
      if (need.every(([fg, r]) => contrast(fg, c) >= r)) return c
    }
    return base
  }
  const hue = { danger: 27, warn: 75, ok: 150, ...s.hues }
  const status = (h: number, c: number, ld: number, ll: number): string => fit({ l: dark ? ld : ll, c, h }, [bg, surface, editorBg, lineHl], T.text, dir)
  const danger = status(hue.danger, 0.17, 0.72, 0.52)
  const warn = status(hue.warn, 0.15, 0.82, 0.58)
  const ok = status(hue.ok, 0.14, 0.76, 0.52)
  // status glyphs must stay readable on a highlighted row too
  const glyphs: [string, number][] = [[danger, 3], [warn, 3], [ok, 3]]

  const accentSoft = tint(surface, accent, dark ? 0.22 : 0.14, [[accent, T.accent], [text, T.text], [muted, 3], ...glyphs])
  const onAccent = [oklch(0.99, 0.01, s.accent.h), oklch(0.17, 0.05, s.accent.h)]
  const accentText = contrast(onAccent[0], accent) >= contrast(onAccent[1], accent) ? onAccent[0] : onAccent[1]
  const selection = tint(editorBg, accent, dark ? 0.34 : 0.24, [[text, T.text], ...glyphs])
  const addBg = tint(editorBg, ok, dark ? 0.2 : 0.16, [[text, T.text]])
  const delBg = tint(editorBg, danger, dark ? 0.2 : 0.14, [[text, T.text]])

  const textLch = hexLch(text)
  const borderStrong = fit({ l: hexLch(surface).l, c: Math.min(s.base.c * 1.5, 0.05), h: s.base.h }, [bg, surface, editorBg], T.ui, dir)
  const border = st.separation === 'rule' ? borderStrong
    : st.separation === 'accent' ? away(surface, { ...hexLch(accent), c: hexLch(accent).c * 0.55 }, 1.6 + 0.6 * k)
    : away(surface, textLch, (st.separation === 'none' ? 1.12 : 1.25) + 0.25 * k)

  const chromeT = { none: 0, subtle: 0, tinted: dark ? 0.08 : 0.05, strong: dark ? 0.11 : 0.07 }[st.chrome]
  const chrome = chromeT ? tint(surface, accent, chromeT, [[text, T.text], [muted, T.muted], [accent, T.accent], [danger, T.text], [warn, T.text], [ok, T.text]]) : surface
  const railOn = st.chrome === 'none' ? surface2 : st.chrome === 'strong' ? accent : accentSoft
  const railOnText = st.chrome === 'none' ? text : st.chrome === 'strong' ? accentText : accent

  const code = (c: string): string => fit(c, [editorBg, lineHl], T.text, dir)
  const syn = Object.fromEntries(Object.entries(s.syn).map(([key, c]) => [key, code(c)])) as unknown as Syn
  const alpha = { glass: 0.7, islands: 0.92, elevated: 0.94, flat: 1, bordered: 1 }[st.surfaces]

  return {
    id: s.id, name: s.name, tagline: s.tagline, dark, group: s.group,
    bg, surface, surface2, border, borderStrong, text, muted, accent, accentText, accentSoft, danger, warn, ok,
    selection, addBg, delBg, editorBg, lineHl, chrome, railOn, railOnText, tabIndicator: st.chrome === 'none' ? text : accent, syn,
    font: st.font, mono: s.mono ?? "'Cascadia Code', 'Cascadia Mono', Consolas, monospace", radius: `${st.radius}px`,
    backdrop: s.backdrop ?? 'none', glass: alpha < 1 ? rgba(chrome, alpha) : chrome, effect: s.effect ?? 'none', tracking: s.tracking ?? 'normal',
    structure: st
  }
}
