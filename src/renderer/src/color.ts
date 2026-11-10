// Colour math for the theme generator: OKLCH <-> sRGB hex, WCAG 2.2 contrast, OKLab distance and mixing.
// Pure functions, no DOM, so tests can check every theme's colours.

export interface Lch { l: number; c: number; h: number }
type Vec = [number, number, number]

const toLinear = (x: number): number => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
const toGamma = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)

function oklabToLinear([L, a, b]: Vec): Vec {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

function linearToOklab([r, g, b]: Vec): Vec {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

const lchToLab = ({ l, c, h }: Lch): Vec => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
const inGamut = (v: Vec): boolean => v.every((x) => x >= -1e-4 && x <= 1 + 1e-4)

/** OKLCH to the nearest in-gamut hex: lightness and hue are kept, chroma is reduced until the colour fits sRGB. */
export function oklch(l: number, c: number, h: number): string {
  const L = Math.min(1, Math.max(0, l))
  let lo = 0, hi = Math.max(0, c)
  if (!inGamut(oklabToLinear(lchToLab({ l: L, c: hi, h })))) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklabToLinear(lchToLab({ l: L, c: mid, h })))) lo = mid
      else hi = mid
    }
    hi = lo
  }
  return rgbHex(oklabToLinear(lchToLab({ l: L, c: hi, h })))
}

function rgbHex(lin: Vec): string {
  return '#' + lin.map((x) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, x))))) * 255).toString(16).padStart(2, '0')).join('')
}

export function hexLinear(hex: string): Vec {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as Vec
}

export const hexLab = (hex: string): Vec => linearToOklab(hexLinear(hex))

export function hexLch(hex: string): Lch {
  const [l, a, b] = hexLab(hex)
  return { l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}

/** WCAG 2.2 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexLinear(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.2 contrast ratio (1 to 21). */
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Euclidean distance in OKLab (0.02 is about one just-noticeable difference). */
export function deltaE(a: string, b: string): number {
  const p = hexLab(a), q = hexLab(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/** Mix two colours in OKLab: t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const p = hexLab(a), q = hexLab(b)
  return rgbHex(oklabToLinear([0, 1, 2].map((i) => p[i] + (q[i] - p[i]) * t) as Vec))
}

export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  return `rgba(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',')},${alpha})`
}

const minContrast = (fg: string, bgs: string[]): number => Math.min(...bgs.map((b) => contrast(fg, b)))

/**
 * Move a colour's OKLCH lightness (towards white for 'up', black for 'down') just far enough that it reaches
 * `ratio` against every background. Hue and chroma are kept (chroma shrinks only where sRGB cannot hold it).
 */
export function fit(color: string | Lch, bgs: string[], ratio: number, dir: 'up' | 'down'): string {
  const c = typeof color === 'string' ? hexLch(color) : color
  const at = (l: number): string => oklch(l, c.c, c.h)
  if (minContrast(at(c.l), bgs) >= ratio) return at(c.l)
  let lo = c.l, hi = dir === 'up' ? 1 : 0
  if (minContrast(at(hi), bgs) < ratio) return at(hi)
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (minContrast(at(mid), bgs) >= ratio) hi = mid
    else lo = mid
  }
  return at(hi)
}

/** Lightness that sits `ratio` away from a background (for dividers and borders that must stay subtle or reach 3:1). */
export function away(from: string, toward: Lch, ratio: number): string {
  const f = hexLch(from)
  const dir = toward.l > f.l ? 'up' : 'down'
  return fit({ l: f.l, c: toward.c, h: toward.h }, [from], ratio, dir)
}
