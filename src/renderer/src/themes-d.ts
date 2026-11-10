import { FONTS, type ThemeSpec } from './themegen'

// Blueprint and the accessibility theme.
export const SPECS_D: ThemeSpec[] = [
  {
    id: 'blueprint', name: 'Blueprint', tagline: 'Drafting-table navy, cyan rules, engineer grid.', group: 'dark',
    base: { l: 0.3, c: 0.085, h: 255 }, accent: { l: 0.84, c: 0.12, h: 215 }, contrast: 40, hues: { ok: 165 },
    syn: { keyword: '#5cc8ff', string: '#b8e986', number: '#ffd166', comment: '#8aa6c8', type: '#9fd8ff', func: '#ffffff', variable: '#e4eefb', punct: '#a0b8d6' },
    structure: { surfaces: 'flat', separation: 'accent', radius: 0, density: 'compact', font: FONTS.text, headFont: FONTS.mono, headWeight: 600, labels: 'mono', iconStroke: 1.25, chrome: 'tinted', motion: 'calm' },
    effect: 'grid', backdrop: 'linear-gradient(rgba(92,200,255,0.07) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, rgba(92,200,255,0.07) 1px, transparent 1px) 0 0 / 24px 24px'
  },
  {
    id: 'high-contrast', name: 'High Contrast', tagline: 'Black, white and yellow. Every line and label at 7:1 or more.', group: 'contrast',
    base: { l: 0, c: 0, h: 0 }, accent: { l: 0.92, c: 0.17, h: 100 }, contrast: 100, hues: { ok: 145, warn: 70 },
    syn: { keyword: '#ffd400', string: '#7dffb0', number: '#ffb36b', comment: '#c8c8c8', type: '#7fe3ff', func: '#ffffff', variable: '#ffffff', punct: '#e0e0e0' },
    structure: { surfaces: 'bordered', separation: 'rule', radius: 4, density: 'regular', font: FONTS.text, headFont: FONTS.text, headWeight: 700, labels: 'normal', iconStroke: 2, chrome: 'strong', motion: 'none' },
    effect: 'contrast'
  }
]
