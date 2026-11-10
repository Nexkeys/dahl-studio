import type { ITheme } from '@xterm/xterm'
import { contrast, ensureContrast, hslToRgb, hueDistance, mix, parseColor, rgbToHsl, toHex, type Rgb } from './color'

/**
 * The xterm.js theme for a Dahl theme: background, text, cursor and selection from the theme, and a 16-colour
 * ANSI palette built from the theme's own accents (danger for red, ok for green, syntax colours for blue and
 * magenta...) when their hue fits the slot, synthesised otherwise, then pushed to readable contrast against the
 * background. Bright colours stay readable in light themes too: PowerShell prints errors in bright red and
 * PSReadLine numbers in bright white.
 */

export const MIN_CONTRAST = 4.5 // normal and bright colours (WCAG AA)
export const DIM_CONTRAST = 3 // brightBlack, used for de-emphasised text

type Slot = 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan'
const HUES: Record<Slot, number> = { red: 0, yellow: 48, green: 125, cyan: 185, blue: 218, magenta: 300 }
const BRIGHT = { red: 'brightRed', green: 'brightGreen', yellow: 'brightYellow', blue: 'brightBlue', magenta: 'brightMagenta', cyan: 'brightCyan' } as const

/** The theme colours a terminal palette is made from (CSS variable values of a Dahl theme). */
export interface TermColors {
  bg: string; fg: string; muted: string; accent: string; selection: string
  danger: string; warn: string; ok: string
  keyword: string; string: string; type: string; func: string
}

export function colorsFromVars(v: Record<string, string>): TermColors {
  return {
    bg: v['--editor-bg'] ?? v['--bg'], fg: v['--text'], muted: v['--muted'], accent: v['--accent'], selection: v['--selection'],
    danger: v['--danger'], warn: v['--warn'], ok: v['--ok'],
    keyword: v['--syn-keyword'], string: v['--syn-string'], type: v['--syn-type'], func: v['--syn-func']
  }
}

const FALLBACK: Rgb = { r: 128, g: 128, b: 128 }
const rgb = (c: string | undefined): Rgb => (c && parseColor(c)) || FALLBACK

/** Pick a theme colour whose hue is close to the slot's, else synthesise one in the theme's saturation. */
function slotColor(slot: Slot, candidates: Rgb[], used: Set<string>, sat: number, dark: boolean): Rgb {
  for (const c of candidates) {
    const h = rgbToHsl(c)
    if (h.s >= 0.3 && h.l > 0.12 && h.l < 0.9 && hueDistance(h.h, HUES[slot]) <= 26 && !used.has(toHex(c))) {
      used.add(toHex(c))
      return c
    }
  }
  return hslToRgb({ h: HUES[slot], s: sat, l: dark ? 0.62 : 0.42 })
}

export function terminalTheme(t: TermColors, dark: boolean): ITheme {
  const bg = rgb(t.bg)
  const fg = rgb(t.fg)
  const c = {
    danger: rgb(t.danger), warn: rgb(t.warn), ok: rgb(t.ok), accent: rgb(t.accent),
    keyword: rgb(t.keyword), string: rgb(t.string), type: rgb(t.type), func: rgb(t.func)
  }
  const chroma = Object.values(c).map(rgbToHsl).filter((h) => h.s > 0.2)
  const sat = Math.min(0.8, Math.max(0.45, chroma.reduce((a, h) => a + h.s, 0) / (chroma.length || 1)))
  const used = new Set<string>()
  const base: Record<Slot, Rgb> = {
    red: slotColor('red', [c.danger, c.keyword, c.accent], used, sat, dark),
    green: slotColor('green', [c.ok, c.string, c.accent], used, sat, dark),
    yellow: slotColor('yellow', [c.warn, c.func, c.string, c.accent], used, sat, dark),
    blue: slotColor('blue', [c.type, c.accent, c.func, c.keyword], used, sat, dark),
    magenta: slotColor('magenta', [c.keyword, c.func, c.accent, c.type], used, sat, dark),
    cyan: slotColor('cyan', [c.type, c.func, c.string, c.accent], used, sat, dark)
  }
  const out: ITheme = {}
  for (const slot of Object.keys(HUES) as Slot[]) {
    const hsl = rgbToHsl(base[slot])
    // dark themes: bright = lighter; light themes: normal is a little deeper so bright can be lighter and still readable
    const normal = ensureContrast(base[slot], bg, dark ? MIN_CONTRAST : MIN_CONTRAST + 1)
    const bright = ensureContrast(hslToRgb({ ...rgbToHsl(normal), s: Math.min(1, hsl.s + 0.08), l: Math.min(0.92, rgbToHsl(normal).l + (dark ? 0.12 : 0.08)) }), bg, MIN_CONTRAST)
    out[slot] = toHex(normal)
    out[BRIGHT[slot]] = toHex(bright)
  }
  const muted = rgb(t.muted)
  if (dark) {
    out.black = toHex(mix(bg, fg, 0.16))
    out.brightBlack = toHex(ensureContrast(muted, bg, DIM_CONTRAST + 0.5))
    out.white = toHex(ensureContrast(mix(fg, bg, 0.12), bg, MIN_CONTRAST))
    out.brightWhite = toHex(ensureContrast(mix(fg, { r: 255, g: 255, b: 255 }, 0.5), bg, MIN_CONTRAST))
  } else {
    out.black = toHex(ensureContrast(fg, bg, MIN_CONTRAST))
    out.brightBlack = toHex(ensureContrast(muted, bg, DIM_CONTRAST + 0.5))
    out.white = toHex(ensureContrast(mix(fg, bg, 0.4), bg, MIN_CONTRAST))
    out.brightWhite = toHex(ensureContrast(mix(fg, bg, 0.3), bg, MIN_CONTRAST))
  }
  const sel = rgb(t.selection)
  // a selection colour too close to the background (some themes keep it subtle) is mixed toward the accent
  const selection = contrast(sel, bg) < 1.25 ? mix(sel, c.accent, 0.35) : sel
  return {
    ...out,
    background: toHex(bg),
    foreground: toHex(fg),
    cursor: toHex(ensureContrast(c.accent, bg, DIM_CONTRAST)),
    cursorAccent: toHex(bg),
    selectionBackground: toHex(selection),
    selectionInactiveBackground: toHex(mix(selection, bg, 0.45)),
    selectionForeground: contrast(fg, selection) < MIN_CONTRAST ? toHex(ensureContrast(fg, selection, MIN_CONTRAST)) : undefined
  }
}

/** The 16 ANSI keys in order (0 to 15), for tests and the palette preview. */
export const ANSI_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const
