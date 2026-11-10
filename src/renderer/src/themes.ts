import type { editor } from 'monaco-editor'
import type { EffectsMode, ThemeId } from '@shared/types'
import { generate, type Palette, type Structure, type ThemeGroup } from './themegen'
import { SPECS_A } from './themes-a'
import { SPECS_B } from './themes-b'
import { SPECS_C } from './themes-c'
import { SPECS_D } from './themes-d'

export type { Palette } from './themegen'

/**
 * Theme registry. Each theme is generated from a few OKLCH inputs plus a structure (themegen.ts). Colours become CSS
 * variables and a Monaco theme; structure becomes variables (density, radius, type, icon stroke, shadows, motion) and
 * data attributes on <html> (surfaces, separation, labels, chrome) that ui-structure.css styles.
 */
export interface Theme {
  id: ThemeId
  name: string
  tagline: string
  dark: boolean
  group: ThemeGroup
  effect: string
  structure: Structure
  palette: Palette
  vars: Record<string, string>
  /** data-* attributes for <html> (and for the Settings previews) */
  data: Record<string, string>
  monaco: editor.IStandaloneThemeData
}

const DENSITY = {
  compact: { row: 22, head: 32, top: 38, tab: 32, ctl: 28, pad: 8, gap: 6, fs: 12.5, sb: 24, rail: 36 },
  regular: { row: 26, head: 38, top: 44, tab: 38, ctl: 32, pad: 12, gap: 10, fs: 13, sb: 26, rail: 40 },
  roomy: { row: 30, head: 42, top: 48, tab: 40, ctl: 34, pad: 14, gap: 12, fs: 13.5, sb: 28, rail: 42 }
}
const MOTION = { none: '0ms', calm: '160ms', lively: '240ms' }

function shadows(p: Palette): [string, string] {
  const ink = p.dark ? '0,0,0' : '28,32,40'
  switch (p.structure.surfaces) {
    case 'elevated': return p.dark
      ? [`inset 0 1px 0 rgba(255,255,255,.04), 0 2px 10px rgba(${ink},.38)`, `0 14px 36px rgba(${ink},.5)`]
      : [`0 1px 2px rgba(${ink},.07), 0 3px 10px rgba(${ink},.05)`, `0 14px 36px rgba(${ink},.14)`]
    case 'islands': return [`0 1px 2px rgba(${ink},${p.dark ? 0.3 : 0.06}), 0 6px 20px rgba(${ink},${p.dark ? 0.3 : 0.07})`, `0 16px 40px rgba(${ink},${p.dark ? 0.5 : 0.16})`]
    case 'glass': return ['inset 0 1px 0 rgba(255,255,255,.08), 0 10px 30px rgba(0,0,0,.35)', '0 18px 44px rgba(0,0,0,.55)']
    case 'flat': return ['none', `0 10px 28px rgba(${ink},${p.dark ? 0.5 : 0.16})`]
    default: return ['none', 'none']
  }
}

function make(p: Palette): Theme {
  const s = (c: string): string => c.replace('#', '').slice(0, 6)
  const st = p.structure
  const d = DENSITY[st.density]
  const [sh1, sh2] = shadows(p)
  const hc = p.group === 'contrast'
  return {
    id: p.id, name: p.name, tagline: p.tagline, dark: p.dark, group: p.group, effect: p.effect, structure: st, palette: p,
    vars: {
      '--bg': p.bg, '--surface': p.surface, '--surface-2': p.surface2, '--border': p.border, '--border-strong': p.borderStrong, '--text': p.text, '--muted': p.muted,
      '--accent': p.accent, '--accent-text': p.accentText, '--accent-soft': p.accentSoft, '--danger': p.danger, '--warn': p.warn, '--ok': p.ok,
      '--selection': p.selection, '--add-bg': p.addBg, '--del-bg': p.delBg, '--editor-bg': p.editorBg, '--line-hl': p.lineHl,
      '--chrome': p.chrome, '--rail-on': p.railOn, '--rail-on-text': p.railOnText, '--tab-ind': p.tabIndicator,
      '--font': p.font, '--font-head': st.headFont, '--head-weight': String(st.headWeight), '--mono': p.mono, '--backdrop': p.backdrop,
      '--glass': p.glass, '--tracking': p.tracking, '--icon-stroke': String(st.iconStroke),
      '--radius': p.radius, '--radius-sm': `${Math.round(st.radius * 0.6)}px`, '--radius-lg': `${st.radius ? st.radius + 4 : 0}px`,
      '--row-h': `${d.row}px`, '--head-h': `${d.head}px`, '--top-h': `${d.top}px`, '--tab-h': `${d.tab}px`, '--ctl-h': `${d.ctl}px`,
      '--pad': `${d.pad}px`, '--gap': `${d.gap}px`, '--fs': `${d.fs}px`, '--sb-h': `${d.sb}px`, '--rail-btn': `${d.rail}px`,
      '--dur': MOTION[st.motion], '--shadow-1': sh1, '--shadow-2': sh2,
      '--syn-keyword': p.syn.keyword, '--syn-string': p.syn.string, '--syn-type': p.syn.type, '--syn-comment': p.syn.comment, '--syn-func': p.syn.func, '--syn-number': p.syn.number
    },
    data: { theme: p.id, effect: p.effect, surface: st.surfaces, sep: st.separation, density: st.density, labels: st.labels, chrome: st.chrome, motion: st.motion, group: p.group },
    monaco: {
      base: hc ? 'hc-black' : p.dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        { token: '', foreground: s(p.text) },
        { token: 'keyword', foreground: s(p.syn.keyword) },
        { token: 'string', foreground: s(p.syn.string) },
        { token: 'number', foreground: s(p.syn.number) },
        { token: 'comment', foreground: s(p.syn.comment), fontStyle: 'italic' },
        { token: 'type', foreground: s(p.syn.type) },
        { token: 'type.identifier', foreground: s(p.syn.type) },
        { token: 'identifier', foreground: s(p.syn.variable) },
        { token: 'delimiter', foreground: s(p.syn.punct) },
        { token: 'tag', foreground: s(p.syn.keyword) },
        { token: 'attribute.name', foreground: s(p.syn.func) },
        { token: 'attribute.value', foreground: s(p.syn.string) },
        { token: 'string.key.json', foreground: s(p.syn.func) },
        { token: 'string.value.json', foreground: s(p.syn.string) },
        { token: 'predefined', foreground: s(p.syn.func) }
      ],
      colors: {
        'editor.background': p.editorBg, 'editor.foreground': p.text, 'editor.lineHighlightBackground': p.lineHl, 'editor.selectionBackground': p.selection,
        'editorLineNumber.foreground': p.muted, 'editorLineNumber.activeForeground': p.text, 'editorCursor.foreground': p.accent, 'editorGutter.background': p.editorBg,
        'editorWidget.background': p.surface, 'editorWidget.border': p.borderStrong, 'diffEditor.insertedLineBackground': p.addBg, 'diffEditor.removedLineBackground': p.delBg,
        'scrollbarSlider.background': p.border + '99', 'minimap.background': p.editorBg, 'editorBracketMatch.border': p.accent
      }
    }
  }
}

export const THEMES: Theme[] = [...SPECS_A, ...SPECS_B, ...SPECS_C, ...SPECS_D].map((spec) => make(generate(spec)))

export function themeById(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function applyTheme(id: ThemeId): void {
  const t = themeById(id)
  const root = document.documentElement
  root.classList.add('theme-switching')
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v)
  for (const [k, v] of Object.entries(t.data)) root.dataset[k] = v
  root.toggleAttribute('data-dark', t.dark)
  root.style.colorScheme = t.dark ? 'dark' : 'light'
  setTimeout(() => root.classList.remove('theme-switching'), 320)
}

let lowEnd = false

/** Low-end: software compositing (no usable GPU, many VMs and Remote Desktop) or 4 logical CPUs or fewer. */
export function detectLowEnd(info: { gpu: string; cpus: number }): void {
  lowEnd = !info.gpu.startsWith('enabled') || info.cpus <= 4
}

export function isLowEnd(): boolean {
  return lowEnd
}

/** Reduced effects drop backdrop blur and animated theme layers (ui-themes.css [data-lite]). */
export function applyEffects(mode: EffectsMode): void {
  document.documentElement.toggleAttribute('data-lite', mode === 'reduced' || (mode === 'auto' && lowEnd))
}
