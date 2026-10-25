import type { Palette } from './themes'
import { PALETTES_C } from './themes-c'

export const PALETTES_B: Palette[] = [
  {
    id: 'vibe-coder', name: 'Vibe Coder', tagline: 'Dusky lavender glass, relaxed and roomy.', dark: true,
    bg: '#14132a', surface: '#1c1b38', surface2: '#252446', border: '#35335e', text: '#e9e7ff', muted: '#9c98cc',
    accent: '#8b7bff', accentText: '#ffffff', accentSoft: '#2c2860', danger: '#ff6b8a', warn: '#ffd27a', ok: '#6ee7c8',
    selection: '#3a3580', addBg: '#1c3a3a', delBg: '#45213a', editorBg: '#17162f', lineHl: '#1f1e3d',
    syn: { keyword: '#b39dff', string: '#8ff0d0', number: '#ffd27a', comment: '#6c69a0', type: '#7cc7ff', func: '#ff9de6', variable: '#e9e7ff', punct: '#9c98cc' },
    radius: '12px', effect: 'glass', glass: 'rgba(28,27,56,0.68)',
    backdrop: 'linear-gradient(160deg, rgba(139,123,255,0.10), transparent 45%)'
  },
  {
    id: 'pen-tester', name: 'Pen Tester', tagline: 'Tactical charcoal, red alerts, uppercase labels.', dark: true,
    bg: '#0e0f10', surface: '#151719', surface2: '#1c1f22', border: '#2b2f33', text: '#d9dcdf', muted: '#7d848b',
    accent: '#ff3b3b', accentText: '#ffffff', accentSoft: '#3a1414', danger: '#ff3b3b', warn: '#ffb020', ok: '#3ddc84',
    selection: '#4a1c1c', addBg: '#15301f', delBg: '#3d1616', editorBg: '#0c0d0e', lineHl: '#16181a',
    syn: { keyword: '#ff5c5c', string: '#e8c07d', number: '#ffb020', comment: '#5c636a', type: '#62b6ff', func: '#f2f2f2', variable: '#d9dcdf', punct: '#7d848b' },
    radius: '3px', effect: 'tactical', glass: 'rgba(21,23,25,0.94)'
  },
  ...PALETTES_C
]
