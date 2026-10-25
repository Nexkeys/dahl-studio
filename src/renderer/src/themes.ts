import type { editor } from 'monaco-editor'
import type { ThemeId } from '@shared/types'
import { PALETTES_A } from './themes-a'
import { PALETTES_B } from './themes-b'

/**
 * Theme registry. A theme is more than colours: palette, syntax colours, UI font, mono font, corner radius,
 * background treatment, panel translucency and an effect (glow, scanlines, petals...). Each drives CSS variables
 * for the whole UI and a matching Monaco theme for editor and diff views.
 */
export interface Palette {
  id: ThemeId; name: string; tagline: string; dark: boolean
  bg: string; surface: string; surface2: string; border: string; text: string; muted: string
  accent: string; accentText: string; accentSoft: string; danger: string; warn: string; ok: string
  selection: string; addBg: string; delBg: string; editorBg: string; lineHl: string
  syn: { keyword: string; string: string; number: string; comment: string; type: string; func: string; variable: string; punct: string }
  font?: string; mono?: string; radius?: string; backdrop?: string; glass?: string; effect?: string; tracking?: string
}

export interface Theme {
  id: ThemeId
  name: string
  tagline: string
  dark: boolean
  effect: string
  vars: Record<string, string>
  monaco: editor.IStandaloneThemeData
}

export const SEGOE = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
export const CASCADIA = "'Cascadia Code', 'Cascadia Mono', Consolas, monospace"

function make(p: Palette): Theme {
  const s = (c: string): string => c.replace('#', '').slice(0, 6)
  return {
    id: p.id, name: p.name, tagline: p.tagline, dark: p.dark, effect: p.effect ?? 'none',
    vars: {
      '--bg': p.bg, '--surface': p.surface, '--surface-2': p.surface2, '--border': p.border, '--text': p.text, '--muted': p.muted,
      '--accent': p.accent, '--accent-text': p.accentText, '--accent-soft': p.accentSoft, '--danger': p.danger, '--warn': p.warn, '--ok': p.ok,
      '--selection': p.selection, '--add-bg': p.addBg, '--del-bg': p.delBg, '--editor-bg': p.editorBg,
      '--font': p.font ?? SEGOE, '--mono': p.mono ?? CASCADIA, '--radius': p.radius ?? '8px', '--backdrop': p.backdrop ?? 'none',
      '--glass': p.glass ?? p.surface, '--tracking': p.tracking ?? 'normal',
      '--syn-keyword': p.syn.keyword, '--syn-string': p.syn.string, '--syn-type': p.syn.type, '--syn-comment': p.syn.comment, '--syn-func': p.syn.func
    },
    monaco: {
      base: p.dark ? 'vs-dark' : 'vs',
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
        'editorWidget.background': p.surface, 'editorWidget.border': p.border, 'diffEditor.insertedLineBackground': p.addBg, 'diffEditor.removedLineBackground': p.delBg,
        'scrollbarSlider.background': p.border + '99', 'minimap.background': p.editorBg, 'editorBracketMatch.border': p.accent
      }
    }
  }
}

export const THEMES: Theme[] = [...PALETTES_A, ...PALETTES_B].map(make)

export function themeById(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function applyTheme(id: ThemeId): void {
  const t = themeById(id)
  const root = document.documentElement
  root.classList.add('theme-switching')
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v)
  root.dataset.theme = t.id
  root.dataset.effect = t.effect
  root.style.colorScheme = t.dark ? 'dark' : 'light'
  setTimeout(() => root.classList.remove('theme-switching'), 320)
}
