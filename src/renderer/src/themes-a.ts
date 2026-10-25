import type { Palette } from './themes'

const MONO_UI = "'Cascadia Code', 'Cascadia Mono', Consolas, monospace"

export const PALETTES_A: Palette[] = [
  {
    id: 'dahl-classic', name: 'Dahl Classic', tagline: 'Warm paper, precise type, quiet green.', dark: false,
    bg: '#f7f5f1', surface: '#ffffff', surface2: '#f1eee8', border: '#e5e1d9', text: '#1d2021', muted: '#6e726e',
    accent: '#1f6f4a', accentText: '#ffffff', accentSoft: '#e4efe8', danger: '#b4412f', warn: '#9a6a12', ok: '#1f7a4d',
    selection: '#d5e6da', addBg: '#e3f3e7', delBg: '#fbe8e5', editorBg: '#fffffe', lineHl: '#f6f4ef',
    syn: { keyword: '#9b3d6e', string: '#2f7a4f', number: '#b0651a', comment: '#949891', type: '#2d6a9f', func: '#6a4fb3', variable: '#1d2021', punct: '#5b5f5b' },
    glass: 'rgba(255,255,255,0.78)', radius: '9px'
  },
  {
    id: 'hacker-mode', name: 'Hacker Mode', tagline: 'Phosphor green on black, monospace UI, CRT scanlines.', dark: true,
    bg: '#030503', surface: '#070b07', surface2: '#0c140c', border: '#143a17', text: '#9dff9d', muted: '#4f9a55',
    accent: '#39ff6a', accentText: '#001a06', accentSoft: '#0d2b12', danger: '#ff4d4d', warn: '#e6ff4d', ok: '#39ff6a',
    selection: '#124d1d', addBg: '#0d3315', delBg: '#3a0d0d', editorBg: '#020402', lineHl: '#081208',
    syn: { keyword: '#39ff6a', string: '#c6ff8a', number: '#e6ff4d', comment: '#3d7a45', type: '#7affd4', func: '#b3ffb3', variable: '#9dff9d', punct: '#5ccf68' },
    font: MONO_UI, radius: '2px', effect: 'scanlines', glass: 'rgba(7,11,7,0.92)',
    backdrop: 'radial-gradient(ellipse at 50% 0%, rgba(57,255,106,0.07), transparent 60%)'
  },
  {
    id: 'baddie-mode', name: 'Baddie Mode', tagline: 'Midnight plum, hot pink, soft rounded glass.', dark: true,
    bg: '#120a14', surface: '#1b1020', surface2: '#25162b', border: '#3a2241', text: '#f7e8f5', muted: '#b08bb0',
    accent: '#ff3fa4', accentText: '#ffffff', accentSoft: '#3d1631', danger: '#ff5c6c', warn: '#ffc06b', ok: '#5ef2b0',
    selection: '#4d1d40', addBg: '#173a2c', delBg: '#4a1726', editorBg: '#150c18', lineHl: '#1f1224',
    syn: { keyword: '#ff3fa4', string: '#ffb3de', number: '#ffc06b', comment: '#7d5a80', type: '#c792ff', func: '#ff8ad0', variable: '#f7e8f5', punct: '#b08bb0' },
    radius: '14px', effect: 'glow', glass: 'rgba(27,16,32,0.72)',
    backdrop: 'radial-gradient(circle at 85% 10%, rgba(255,63,164,0.12), transparent 40%)'
  }
]
