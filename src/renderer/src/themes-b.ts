import { FONTS, type ThemeSpec } from './themegen'

// Dark themes, part one: the calm working themes.
export const SPECS_B: ThemeSpec[] = [
  {
    id: 'midnight-terminal', name: 'Midnight Terminal', tagline: 'Deep navy, calm green, long-session focus.', group: 'dark',
    base: { l: 0.19, c: 0.03, h: 255 }, accent: { l: 0.76, c: 0.14, h: 160 }, contrast: 30,
    syn: { keyword: '#c792ea', string: '#a5d6a7', number: '#ffab70', comment: '#7a8794', type: '#7dcfff', func: '#82aaff', variable: '#d8dee6', punct: '#8b95a3' },
    structure: { surfaces: 'elevated', separation: 'hairline', radius: 6, density: 'regular', font: FONTS.text, headFont: FONTS.text, headWeight: 600, labels: 'normal', iconStroke: 1.5, chrome: 'subtle', motion: 'calm' }
  },
  {
    id: 'forest-syntax', name: 'Forest Syntax', tagline: 'Deep moss, amber light, organic calm.', group: 'dark',
    base: { l: 0.215, c: 0.04, h: 150 }, accent: { l: 0.78, c: 0.14, h: 75 }, contrast: 40,
    syn: { keyword: '#d9a441', string: '#a8d08d', number: '#e2a272', comment: '#7d9a83', type: '#7fc9b6', func: '#e8d48a', variable: '#dfe9dc', punct: '#8da592' },
    structure: { surfaces: 'elevated', separation: 'hairline', radius: 10, density: 'roomy', font: FONTS.text, headFont: FONTS.humanist, headWeight: 600, labels: 'normal', iconStroke: 1.5, chrome: 'subtle', motion: 'calm' },
    effect: 'grain'
  },
  {
    id: 'vibe-coder', name: 'Vibe Coder', tagline: 'Lavender glass islands over a dusk gradient.', group: 'dark',
    base: { l: 0.215, c: 0.06, h: 285 }, accent: { l: 0.72, c: 0.16, h: 290 }, contrast: 35,
    syn: { keyword: '#b39dff', string: '#8ff0d0', number: '#ffd27a', comment: '#8a87bd', type: '#7cc7ff', func: '#ff9de6', variable: '#e9e7ff', punct: '#9c98cc' },
    structure: { surfaces: 'islands', separation: 'none', radius: 14, density: 'roomy', font: FONTS.display, headFont: FONTS.display, headWeight: 600, labels: 'normal', iconStroke: 1.5, chrome: 'subtle', motion: 'lively' },
    effect: 'glass', backdrop: 'linear-gradient(160deg, rgba(139,123,255,0.22), transparent 55%), radial-gradient(circle at 100% 100%, rgba(255,120,220,0.12), transparent 50%)'
  }
]
