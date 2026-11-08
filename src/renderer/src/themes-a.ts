import { FONTS, type ThemeSpec } from './themegen'

// Light themes. Each one differs in background tint and in structure, not only in accent.
export const SPECS_A: ThemeSpec[] = [
  {
    id: 'dahl-classic', name: 'Dahl Classic', tagline: 'Warm paper, precise type, quiet green.', group: 'light',
    base: { l: 0.948, c: 0.02, h: 85 }, accent: { l: 0.48, c: 0.11, h: 158 }, contrast: 45,
    syn: { keyword: '#9b3d6e', string: '#2f7a4f', number: '#b0651a', comment: '#7c8079', type: '#2d6a9f', func: '#6a4fb3', variable: '#1d2021', punct: '#5b5f5b' },
    structure: { surfaces: 'elevated', separation: 'hairline', radius: 8, density: 'regular', font: FONTS.text, headFont: FONTS.display, headWeight: 600, labels: 'normal', iconStroke: 1.5, chrome: 'subtle', motion: 'calm' }
  },
  {
    id: 'ink-paper', name: 'Ink & Paper', tagline: 'Black ink on white, one red pen, nothing else.', group: 'light',
    base: { l: 1, c: 0, h: 0 }, accent: { l: 0.52, c: 0.2, h: 27 }, contrast: 85,
    syn: { keyword: '#000000', string: '#5a5a5a', number: '#d62f2f', comment: '#6f6f6f', type: '#333333', func: '#000000', variable: '#222222', punct: '#555555' },
    structure: { surfaces: 'flat', separation: 'rule', radius: 0, density: 'roomy', font: FONTS.text, headFont: FONTS.serif, headWeight: 600, labels: 'normal', iconStroke: 1.25, chrome: 'none', motion: 'calm' },
    effect: 'ink'
  },
  {
    id: 'arctic-focus', name: 'Arctic Focus', tagline: 'Ice-white islands on blue-grey, zero distraction.', group: 'light',
    base: { l: 0.905, c: 0.024, h: 245 }, accent: { l: 0.5, c: 0.13, h: 252 }, contrast: 35,
    syn: { keyword: '#0b5cad', string: '#21794d', number: '#b35c00', comment: '#6d8292', type: '#6b46c1', func: '#0f7c8c', variable: '#14222e', punct: '#61788a' },
    structure: { surfaces: 'islands', separation: 'none', radius: 12, density: 'roomy', font: FONTS.text, headFont: FONTS.display, headWeight: 600, labels: 'normal', iconStroke: 1.5, chrome: 'none', motion: 'calm' },
    effect: 'frost'
  },
  {
    id: 'sakura-flow', name: 'Sakura Flow', tagline: 'Blossom paper, rose accents, drifting petals.', group: 'light',
    base: { l: 0.925, c: 0.055, h: 352 }, accent: { l: 0.55, c: 0.17, h: 357 }, contrast: 40,
    syn: { keyword: '#c2185b', string: '#5a8f3e', number: '#c96b2c', comment: '#9a7f88', type: '#7a5cc4', func: '#d6457a', variable: '#3b2a30', punct: '#94737e' },
    structure: { surfaces: 'elevated', separation: 'hairline', radius: 16, density: 'roomy', font: FONTS.text, headFont: FONTS.soft, headWeight: 700, labels: 'normal', iconStroke: 1.75, chrome: 'tinted', motion: 'lively' },
    effect: 'petals', backdrop: 'radial-gradient(circle at 100% 0%, rgba(214,69,122,0.10), transparent 45%)'
  }
]
