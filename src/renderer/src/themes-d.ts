import type { Palette } from './themes'

export const PALETTES_D: Palette[] = [
  {
    id: 'arctic-focus', name: 'Arctic Focus', tagline: 'Crisp ice white, steel blue, zero distraction.', dark: false,
    bg: '#f3f7fa', surface: '#ffffff', surface2: '#eaf1f6', border: '#d8e3eb', text: '#14222e', muted: '#61788a',
    accent: '#1f6fb2', accentText: '#ffffff', accentSoft: '#e1eef8', danger: '#c53030', warn: '#b7791f', ok: '#2f855a',
    selection: '#cfe3f3', addBg: '#e3f4ea', delBg: '#fce4e4', editorBg: '#fbfdfe', lineHl: '#f0f6fa',
    syn: { keyword: '#0b5cad', string: '#21794d', number: '#b35c00', comment: '#90a4b3', type: '#6b46c1', func: '#0f7c8c', variable: '#14222e', punct: '#61788a' },
    radius: '6px', effect: 'frost', glass: 'rgba(255,255,255,0.8)'
  },
  {
    id: 'forest-syntax', name: 'Forest Syntax', tagline: 'Deep moss, amber light, organic calm.', dark: true,
    bg: '#0f1712', surface: '#14201a', surface2: '#1a2a21', border: '#28402f', text: '#dfe9dc', muted: '#8da592',
    accent: '#d9a441', accentText: '#1a1204', accentSoft: '#33301a', danger: '#e2725b', warn: '#d9a441', ok: '#7fc97f',
    selection: '#2c4433', addBg: '#1d3a26', delBg: '#3d2219', editorBg: '#111b15', lineHl: '#17241c',
    syn: { keyword: '#d9a441', string: '#a8d08d', number: '#e2a272', comment: '#5d7a63', type: '#7fc9b6', func: '#e8d48a', variable: '#dfe9dc', punct: '#8da592' },
    radius: '10px', effect: 'grain', glass: 'rgba(20,32,26,0.86)'
  },
  {
    id: 'solar-flare', name: 'Solar Flare', tagline: 'Ember dark, molten orange and gold.', dark: true,
    bg: '#140d09', surface: '#1d130d', surface2: '#281a11', border: '#3d2818', text: '#fbe9d9', muted: '#c09a7d',
    accent: '#ff7a1a', accentText: '#1a0b00', accentSoft: '#3d2210', danger: '#ff4f4f', warn: '#ffc233', ok: '#9ad66b',
    selection: '#4d2c14', addBg: '#22351a', delBg: '#4a1a14', editorBg: '#170f0a', lineHl: '#21160e',
    syn: { keyword: '#ff7a1a', string: '#ffd27a', number: '#ffc233', comment: '#80634e', type: '#ff9f7a', func: '#ffb84d', variable: '#fbe9d9', punct: '#c09a7d' },
    radius: '10px', effect: 'glow', glass: 'rgba(29,19,13,0.84)'
  }
]
