import type { Palette } from './themes'

export const PALETTES_E: Palette[] = [
  {
    id: 'blueprint', name: 'Blueprint', tagline: 'Drafting-table navy, cyan lines, engineer grid.', dark: true,
    bg: '#0b1d33', surface: '#0f2440', surface2: '#132c4d', border: '#24456e', text: '#e4eefb', muted: '#88a5c8',
    accent: '#5cc8ff', accentText: '#04131f', accentSoft: '#123a5c', danger: '#ff6b6b', warn: '#ffd166', ok: '#6be3a4',
    selection: '#1d4a7a', addBg: '#113a35', delBg: '#3e1f2b', editorBg: '#0c203a', lineHl: '#11284a',
    syn: { keyword: '#5cc8ff', string: '#b8e986', number: '#ffd166', comment: '#5d7ea6', type: '#9fd8ff', func: '#ffffff', variable: '#e4eefb', punct: '#88a5c8' },
    radius: '4px', effect: 'grid', glass: 'rgba(15,36,64,0.88)',
    backdrop: 'linear-gradient(rgba(92,200,255,0.07) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, rgba(92,200,255,0.07) 1px, transparent 1px) 0 0 / 24px 24px'
  },
  {
    id: 'ink-paper', name: 'Ink & Paper', tagline: 'Black ink on white, one red pen, nothing else.', dark: false,
    bg: '#fafafa', surface: '#ffffff', surface2: '#f2f2f2', border: '#e0e0e0', text: '#111111', muted: '#6b6b6b',
    accent: '#d62f2f', accentText: '#ffffff', accentSoft: '#fbe6e6', danger: '#d62f2f', warn: '#a66300', ok: '#2b7a3d',
    selection: '#e4e4e4', addBg: '#e8f3ea', delBg: '#fbe6e6', editorBg: '#ffffff', lineHl: '#f6f6f6',
    syn: { keyword: '#000000', string: '#5a5a5a', number: '#d62f2f', comment: '#a0a0a0', type: '#333333', func: '#000000', variable: '#222222', punct: '#7a7a7a' },
    radius: '2px', effect: 'ink', glass: '#ffffff'
  }
]
