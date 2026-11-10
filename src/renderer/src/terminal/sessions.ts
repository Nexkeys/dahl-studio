import type { PtyEvent, PtyShells, ShellKind, ThemeId } from '@shared/types'
import { AckBatcher, parseShellMark, type ShellMark } from '@shared/pty'
import { findDevServerUrl } from '@shared/preview'
import { api, useStore } from '../store'
import { themeById } from '../themes'
import { colorsFromVars, terminalTheme } from './palette'
import { fitTerm, makeXterm, type Xterm } from './xterm'
import { EMPTY_ROOT, getDefaultShell, patchMeta, patchRoot, rememberRunning, useTerms, type TermMeta } from './store'

/**
 * Terminal sessions for the whole window. xterm.js instances live here, outside React, so they survive the panel
 * being hidden, a switch to another view or project, and come back with their scrollback: the panel only lends
 * its body element (mountHost) and the active terminal's element is moved into it.
 */

interface Live extends Xterm {
  acks: AckBatcher
  tail: string
  promptSeen: boolean
  queued: string | null
  commandLine: string
}

const live = new Map<string, Live>()
const hosts = new Map<string, HTMLElement>()
const killing = new Set<string>()
const pendingNew = new Set<string>()

let shellsP: Promise<PtyShells> | null = null
export function loadShells(): Promise<PtyShells> {
  shellsP ??= api.invoke<PtyShells>('pty:shells').then((s) => (useTerms.setState({ shells: s }), s), (e) => ((shellsP = null), Promise.reject(e)))
  return shellsP
}

function currentTheme(): ReturnType<typeof terminalTheme> {
  const t = themeById(useStore.getState().settings?.theme as ThemeId)
  return terminalTheme(colorsFromVars(t.vars), t.dark)
}

const notifyError = (m: string): void => useStore.getState().notify(m, 'error')
const metaOf = (id: string): TermMeta | undefined => useTerms.getState().meta[id]
export const liveTerm = (id: string): Live | undefined => live.get(id)

/** Show the active terminal of a project and hide the others (they stay attached, so switching is instant). */
export function showActive(root: string): void {
  const r = useTerms.getState().roots[root] ?? EMPTY_ROOT
  for (const id of r.ids) {
    const l = live.get(id)
    if (l) l.el.style.display = id === r.active ? '' : 'none'
  }
  const a = r.active ? live.get(r.active) : undefined
  if (a) requestAnimationFrame(() => (fitTerm(a), a.term.refresh(0, a.term.rows - 1)))
}

export function setActive(root: string, id: string, focus = true): void {
  patchRoot(root, (r) => ({ ...r, active: id }))
  showActive(root)
  if (focus) live.get(id)?.term.focus()
}

export function mountHost(root: string, el: HTMLElement): void {
  hosts.set(root, el)
  for (const id of (useTerms.getState().roots[root] ?? EMPTY_ROOT).ids) {
    const l = live.get(id)
    if (l && l.el.parentElement !== el) el.appendChild(l.el)
  }
  showActive(root)
}

export function unmountHost(root: string, el: HTMLElement): void {
  if (hosts.get(root) === el) hosts.delete(root)
  for (const l of live.values()) if (l.el.parentElement === el) el.removeChild(l.el)
}

export function fitActive(root: string): void {
  const a = useTerms.getState().roots[root]?.active
  const l = a ? live.get(a) : undefined
  if (l) fitTerm(l)
}

/** Open a new terminal in a project's mounted panel. */
export async function createTerminal(root: string, shellId?: ShellKind): Promise<string | null> {
  let info: PtyShells
  try {
    info = await loadShells()
  } catch (e) {
    notifyError((e as Error).message)
    return null
  }
  const host = hosts.get(root)
  const shell = info.shells.find((s) => s.id === (shellId ?? getDefaultShell())) ?? info.shells[0]
  if (!host) return null
  if (!shell) return (notifyError('No shell was found on this PC.'), null)
  const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const call = (ch: string, ...a: unknown[]): void => void api.invoke(ch, id, ...a).catch(() => {})
  const x = makeXterm(currentTheme(), info.buildNumber, {
    input: (d) => call('pty:write', d),
    resize: (c, r) => call('pty:resize', c, r),
    link: (e, url) => onLink(root, e, url)
  })
  const l: Live = { ...x, acks: new AckBatcher((n) => call('pty:ack', n)), tail: '', promptSeen: false, queued: null, commandLine: '' }
  live.set(id, l)
  x.term.parser.registerOscHandler(633, (data) => (onMark(id, parseShellMark(data)), true))
  const meta: TermMeta = { id, root, shell, running: null, integrated: shell.id === 'pwsh' || shell.id === 'powershell', exited: undefined, devUrl: null }
  useTerms.setState((s) => ({ meta: { ...s.meta, [id]: meta } }))
  patchRoot(root, (r) => ({ ids: [...r.ids, id], active: id }))
  host.appendChild(x.el)
  x.term.open(x.el)
  showActive(root)
  fitTerm(l)
  try {
    await api.invoke('pty:create', id, root, shell.id, x.term.cols, x.term.rows)
  } catch (e) {
    x.term.write(`\x1b[31m${(e as Error).message}\x1b[0m\r\n`)
    patchMeta(id, { exited: -1 })
  }
  x.term.focus()
  return id
}

function dispose(id: string): void {
  const l = live.get(id)
  const m = metaOf(id)
  live.delete(id)
  killing.delete(id)
  l?.term.dispose()
  l?.el.remove()
  if (!m) return
  useTerms.setState((s) => {
    const { [id]: _gone, ...meta } = s.meta
    return { meta }
  })
  patchRoot(m.root, (r) => {
    const i = r.ids.indexOf(id)
    const ids = r.ids.filter((x) => x !== id)
    return { ids, active: r.active === id ? ids[Math.min(i, ids.length - 1)] ?? null : r.active }
  })
  updateRunning(m.root)
  showActive(m.root)
}

/** Kill a terminal's shell and everything it started, and close its tab. */
export function killTerminal(id: string): void {
  const m = metaOf(id)
  if (!m) return
  if (m.exited !== undefined) return dispose(id)
  killing.add(id)
  void api.invoke('pty:kill', id).catch(() => {})
  setTimeout(() => live.has(id) && dispose(id), 4000) // the host never answered: close the tab anyway
}

export function killProject(root: string): void {
  for (const id of [...(useTerms.getState().roots[root] ?? EMPTY_ROOT).ids]) killTerminal(id)
}

function onExit(id: string, code: number | null): void {
  const m = metaOf(id)
  const l = live.get(id)
  if (!m || !l) return
  // closed from the tab, or `exit` typed at the prompt (code 0): the tab goes, as in VS Code
  if (killing.has(id) || code === 0) return dispose(id)
  l.term.write(`\r\n\x1b[90m[The shell exited with code ${code ?? 'unknown'}. Close this tab or open a new terminal.]\x1b[0m\r\n`)
  patchMeta(id, { exited: code, running: null })
  updateRunning(m.root)
}

function onEvent(e: PtyEvent): void {
  const l = live.get(e.id)
  if (!l) return
  if (e.type === 'exit') return onExit(e.id, e.code ?? null)
  const d = e.data ?? ''
  l.term.write(d, () => l.acks.drawn(d.length))
  // a dev server announced its address (Vite, Next, http-server...): offer it in the Preview panel
  const text = l.tail + d
  l.tail = d.slice(-300)
  if (/https?:/i.test(text)) {
    const u = findDevServerUrl(text)
    if (u && metaOf(e.id)?.devUrl !== u) patchMeta(e.id, { devUrl: u })
  }
}

function onMark(id: string, mark: ShellMark | null): void {
  const l = live.get(id)
  const m = metaOf(id)
  if (!mark || !l || !m) return
  if (mark.kind === 'prompt-start' || mark.kind === 'prompt-end') {
    l.promptSeen = true
    if (mark.kind === 'prompt-end' && l.queued) flushQueued(id)
  } else if (mark.kind === 'command-line') l.commandLine = mark.command
  else if (mark.kind === 'executed') {
    patchMeta(id, { running: l.commandLine.trim() || null })
    updateRunning(m.root)
  } else if (mark.kind === 'finished' && m.running) {
    patchMeta(id, { running: null })
    updateRunning(m.root)
  }
}

/** Keep "the command running in this project" on disk, so a restart can offer to run it again. */
function updateRunning(root: string): void {
  const s = useTerms.getState()
  const ids = (s.roots[root] ?? EMPTY_ROOT).ids
  rememberRunning(root, ids.map((id) => s.meta[id]?.running).find((c) => !!c) ?? null)
}

function flushQueued(id: string): void {
  const l = live.get(id)
  if (!l?.queued) return
  void api.invoke('pty:write', id, `${l.queued}\r`).catch(() => {})
  l.queued = null
}

/** Type a command into the project's active terminal (a new one if none can take it) once its prompt is up. */
export async function runCommand(root: string, cmd: string): Promise<void> {
  const r = useTerms.getState().roots[root] ?? EMPTY_ROOT
  const usable = r.active && metaOf(r.active)?.exited === undefined && !metaOf(r.active)?.running ? r.active : null
  const id = usable ?? (await createTerminal(root))
  const l = id ? live.get(id) : undefined
  if (!id || !l) return
  l.queued = cmd
  if (l.promptSeen) flushQueued(id)
  else setTimeout(() => flushQueued(id), 3000) // shells without prompt marks (Git Bash)
  l.term.focus()
}

export function sendInterrupt(id: string): void {
  void api.invoke('pty:write', id, '\x03').catch(() => {})
  live.get(id)?.term.focus()
}

export function clearTerminal(id: string): void {
  const l = live.get(id)
  if (!l) return
  l.term.clear()
  l.tail = ''
  patchMeta(id, { devUrl: null })
  l.term.focus()
}

function onLink(root: string, e: MouseEvent, url: string): void {
  if (!(e.ctrlKey || e.metaKey)) return
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$)/i.test(url)) useTerms.setState({ linkMenu: { x: e.clientX, y: e.clientY, url: url.replace('//0.0.0.0', '//localhost'), root } })
  else if (/^https?:\/\//i.test(url)) window.open(url) // the main process opens it in the system browser
}

/** Ctrl+Shift+` from anywhere in the workspace: a new terminal (showing the panel first if it is hidden). */
export function requestNewTerminal(): void {
  const st = useStore.getState()
  const root = st.settings?.activeProject
  if (st.view !== 'workspace' || !root) return
  if (st.showTerminal && hosts.has(root)) return void createTerminal(root)
  pendingNew.add(root)
  st.set({ showTerminal: true })
}

export function takePendingNew(root: string): boolean {
  return pendingNew.delete(root)
}

let started = false
export function initTerminals(): void {
  if (started) return
  started = true
  void api.invoke('pty:reset').catch(() => {})
  api.on('pty:event', onEvent)
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'Backquote') {
      e.preventDefault()
      requestNewTerminal()
    }
  }, true)
  useStore.subscribe((s, prev) => {
    if (s.settings?.theme !== prev.settings?.theme) {
      const th = currentTheme()
      for (const l of live.values()) l.term.options.theme = th
    }
    // a closed project takes its terminals with it
    if (s.settings?.openProjects !== prev.settings?.openProjects && s.settings) {
      const open = new Set(s.settings.openProjects.map((p) => p.toLowerCase()))
      for (const root of Object.keys(useTerms.getState().roots)) if (!open.has(root.toLowerCase())) killProject(root)
    }
  })
}
