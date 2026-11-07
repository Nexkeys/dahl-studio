// Small colour toolkit for the terminal palette: parse, HSL, WCAG contrast. No DOM, so it runs in tests.

export interface Rgb { r: number; g: number; b: number }
export interface Hsl { h: number; s: number; l: number }

/** #rgb, #rrggbb, #rrggbbaa, rgb() and rgba() (alpha dropped). Unknown input gives null. */
export function parseColor(c: string): Rgb | null {
  const s = c.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16) }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
  if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]) }
  return null
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return { h: h * 60, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 }
}

export function luminance({ r, g, b }: Rgb): number {
  const ch = (v: number): number => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Mix two colours (t = 0 gives a, 1 gives b). */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

/** Smallest change of lightness (away from the background) that reaches the target contrast. Hue is kept. */
export function ensureContrast(c: Rgb, bg: Rgb, ratio: number): Rgb {
  if (contrast(c, bg) >= ratio) return c
  const hsl = rgbToHsl(c)
  const lighter = luminance(bg) < 0.4
  for (let i = 1; i <= 50; i++) {
    const l = Math.min(1, Math.max(0, hsl.l + (lighter ? 0.02 : -0.02) * i))
    const next = hslToRgb({ ...hsl, l })
    if (contrast(next, bg) >= ratio || l === 0 || l === 1) return next
  }
  return lighter ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }
}

/** Shortest distance between two hues in degrees. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
