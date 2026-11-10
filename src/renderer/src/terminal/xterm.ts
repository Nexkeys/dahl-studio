import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { CASCADIA } from '../themes'

/**
 * One xterm.js instance with the VS Code-like input behaviour: Ctrl+C copies when text is selected (otherwise it
 * interrupts), Ctrl+V / Ctrl+Shift+V paste, Ctrl+Shift+C copies, right-click copies a selection or pastes,
 * selecting text copies it, and Ctrl+click follows links.
 */

export interface XtermHooks {
  input: (data: string) => void
  resize: (cols: number, rows: number) => void
  link: (e: MouseEvent, url: string) => void
}

export interface Xterm {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
}

const copyText = (t: string): void => void navigator.clipboard.writeText(t).catch(() => {})

export function paste(term: Terminal): void {
  void navigator.clipboard.readText().then((t) => t && term.paste(t), () => {})
}

export function copySelection(term: Terminal): boolean {
  if (!term.hasSelection()) return false
  copyText(term.getSelection())
  return true
}

export function makeXterm(theme: ITheme, buildNumber: number, hooks: XtermHooks): Xterm {
  const term = new Terminal({
    fontFamily: CASCADIA,
    fontSize: 13,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    cursorInactiveStyle: 'outline',
    scrollback: 10_000,
    theme,
    // a safety net for 256-colour and true-colour output the palette does not control
    minimumContrastRatio: 4.5,
    allowProposedApi: false,
    windowsPty: buildNumber ? { backend: 'conpty', buildNumber } : undefined,
    rightClickSelectsWord: false,
    drawBoldTextInBrightColors: true,
    smoothScrollDuration: 0,
    scrollSensitivity: 1,
    fastScrollModifier: 'alt',
    rescaleOverlappingGlyphs: true
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon((e, url) => hooks.link(e, url), {
    hover: () => void (term.element && (term.element.title = 'Ctrl+click to open the link')),
    leave: () => void (term.element && (term.element.title = ''))
  }))

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const k = e.key.toLowerCase()
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey
    // Ctrl+Shift+` (new terminal) is handled by the window listener in sessions.ts; keep it from the shell
    if (ctrl && e.shiftKey && e.code === 'Backquote') return false
    if (ctrl && e.shiftKey && k === 'c') return (e.preventDefault(), copySelection(term), false)
    if (ctrl && k === 'v') return (e.preventDefault(), paste(term), false)
    if (ctrl && !e.shiftKey && k === 'c' && term.hasSelection()) {
      e.preventDefault()
      copySelection(term)
      term.clearSelection()
      return false
    }
    // app shortcuts stay with the app instead of reaching the shell (Ctrl+J and Ctrl+B are taken earlier)
    if (ctrl && (k === 'p' || k === ',' || (e.shiftKey && k === 'p'))) return false
    return true
  })

  term.onData(hooks.input)
  term.onBinary(hooks.input)
  term.onResize(({ cols, rows }) => hooks.resize(cols, rows))

  let copyTimer: ReturnType<typeof setTimeout> | null = null
  term.onSelectionChange(() => {
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => void (term.hasSelection() && copyText(term.getSelection())), 180)
  })

  const el = document.createElement('div')
  el.className = 'xterm-host'
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (copySelection(term)) term.clearSelection()
    else paste(term)
  })
  return { term, fit, el }
}

/** Fit the grid to the host. A no-op while hidden or detached, where the measured size would be 0. */
export function fitTerm(x: Xterm): void {
  if (!x.el.isConnected || x.el.offsetWidth < 20 || x.el.offsetHeight < 10) return
  try {
    const d = x.fit.proposeDimensions()
    if (d && Number.isFinite(d.cols) && Number.isFinite(d.rows) && (d.cols !== x.term.cols || d.rows !== x.term.rows)) x.term.resize(Math.max(d.cols, 2), Math.max(d.rows, 1))
  } catch {
    /* renderer not ready yet */
  }
}
