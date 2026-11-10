import { FONTS, type ThemeSpec } from './themegen'

// Dark themes, part two: the loud ones.
export const SPECS_C: ThemeSpec[] = [
  {
    id: 'hacker-mode', name: 'Hacker Mode', tagline: 'Phosphor green on black, monospace UI, CRT scanlines.', group: 'dark',
    base: { l: 0.11, c: 0.025, h: 150 }, accent: { l: 0.86, c: 0.26, h: 145 }, contrast: 70, hues: { ok: 145, warn: 105 },
    syn: { keyword: '#39ff6a', string: '#c6ff8a', number: '#e6ff4d', comment: '#4f9a55', type: '#7affd4', func: '#b3ffb3', variable: '#9dff9d', punct: '#5ccf68' },
    structure: { surfaces: 'flat', separation: 'accent', radius: 2, density: 'compact', font: FONTS.mono, headFont: FONTS.mono, headWeight: 700, labels: 'mono', iconStroke: 1.5, chrome: 'strong', motion: 'lively' },
    effect: 'scanlines', backdrop: 'radial-gradient(ellipse at 50% 0%, rgba(57,255,106,0.08), transparent 60%)'
  },
  {
    id: 'pen-tester', name: 'Pen Tester', tagline: 'Tactical charcoal, hard edges, red only for alerts.', group: 'dark',
    base: { l: 0.165, c: 0.004, h: 250 }, accent: { l: 0.63, c: 0.23, h: 27 }, contrast: 60,
    syn: { keyword: '#ff5c5c', string: '#e8c07d', number: '#ffb020', comment: '#7a8188', type: '#62b6ff', func: '#f2f2f2', variable: '#d9dcdf', punct: '#8a9198' },
    structure: { surfaces: 'bordered', separation: 'rule', radius: 2, density: 'compact', font: FONTS.din, headFont: FONTS.din, headWeight: 600, labels: 'upper', iconStroke: 2, chrome: 'none', motion: 'none' },
    effect: 'tactical', tracking: '0.01em'
  },
  {
    id: 'baddie-mode', name: 'Baddie Mode', tagline: 'Midnight plum, hot pink, soft rounded glass.', group: 'dark',
    base: { l: 0.17, c: 0.05, h: 335 }, accent: { l: 0.7, c: 0.24, h: 355 }, contrast: 50,
    syn: { keyword: '#ff3fa4', string: '#ffb3de', number: '#ffc06b', comment: '#a07aa3', type: '#c792ff', func: '#ff8ad0', variable: '#f7e8f5', punct: '#b08bb0' },
    structure: { surfaces: 'glass', separation: 'hairline', radius: 18, density: 'roomy', font: FONTS.display, headFont: FONTS.display, headWeight: 700, labels: 'normal', iconStroke: 2, chrome: 'strong', motion: 'lively' },
    effect: 'glow', backdrop: 'radial-gradient(circle at 85% 8%, rgba(255,63,164,0.20), transparent 42%), radial-gradient(circle at 0% 100%, rgba(170,90,255,0.14), transparent 45%)'
  },
  {
    id: 'solar-flare', name: 'Solar Flare', tagline: 'Ember dark, molten orange, heavy display type.', group: 'dark',
    base: { l: 0.175, c: 0.035, h: 45 }, accent: { l: 0.72, c: 0.19, h: 50 }, contrast: 75,
    syn: { keyword: '#ff7a1a', string: '#ffd27a', number: '#ffc233', comment: '#a3846c', type: '#ff9f7a', func: '#ffb84d', variable: '#fbe9d9', punct: '#c09a7d' },
    structure: { surfaces: 'elevated', separation: 'hairline', radius: 10, density: 'regular', font: FONTS.text, headFont: FONTS.din, headWeight: 700, labels: 'upper', iconStroke: 2, chrome: 'strong', motion: 'lively' },
    effect: 'flare', backdrop: 'linear-gradient(180deg, rgba(255,122,26,0.16), transparent 220px)'
  }
]
