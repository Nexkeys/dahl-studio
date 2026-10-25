import type { Palette } from './themes'
import { PALETTES_D } from './themes-d'

export const PALETTES_C: Palette[] = [
  {
    id: 'midnight-terminal', name: 'Midnight Terminal', tagline: 'Deep navy, calm green, long-session focus.', dark: true,
    bg: '#0f1216', surface: '#151a20', surface2: '#1b2129', border: '#27303a', text: '#d8dee6', muted: '#8590a0',
    accent: '#4cc38a', accentText: '#07140d', accentSoft: '#173326', danger: '#f0715f', warn: '#e0b453', ok: '#4cc38a',
    selection: '#2a3b4d', addBg: '#163324', delBg: '#3a1c1c', editorBg: '#11151a', lineHl: '#171d24',
    syn: { keyword: '#c792ea', string: '#a5d6a7', number: '#ffab70', comment: '#5f6b78', type: '#7dcfff', func: '#82aaff', variable: '#d8dee6', punct: '#8b95a3' },
    glass: 'rgba(21,26,32,0.86)'
  },
  {
    id: 'sakura-flow', name: 'Sakura Flow', tagline: 'Blossom paper, rose accents, drifting petals.', dark: false,
    bg: '#fdf6f7', surface: '#ffffff', surface2: '#fbecef', border: '#f2d9df', text: '#3b2a30', muted: '#94737e',
    accent: '#d6457a', accentText: '#ffffff', accentSoft: '#fbe1ea', danger: '#c0392b', warn: '#b7791f', ok: '#2f855a',
    selection: '#f8d0de', addBg: '#e6f6ec', delBg: '#fde2e2', editorBg: '#fffcfd', lineHl: '#fdf1f4',
    syn: { keyword: '#c2185b', string: '#5a8f3e', number: '#c96b2c', comment: '#b5a1a8', type: '#7a5cc4', func: '#d6457a', variable: '#3b2a30', punct: '#94737e' },
    radius: '12px', effect: 'petals', glass: 'rgba(255,255,255,0.74)'
  },
  ...PALETTES_D
]
