import { create } from 'zustand'
import type { PtyShells, ShellInfo, ShellKind } from '@shared/types'

/** One terminal tab. Reactive fields only; the xterm.js instance lives in sessions.ts. */
export interface TermMeta {
  id: string
  root: string
  shell: ShellInfo
  /** the command running now (from shell integration), or null at the prompt */
  running: string | null
  /** the shell reports commands (PowerShell with PSReadLine); others get Stop at all times */
  integrated: boolean
  /** undefined while the shell runs, then its exit code */
  exited: number | null | undefined
  /** a dev server address seen in this terminal's output */
  devUrl: string | null
}

export interface RootTerms {
  ids: string[]
  active: string | null
}

interface TermsState {
  roots: Record<string, RootTerms>
  meta: Record<string, TermMeta>
  shells: PtyShells | null
  /** per project: the command that was running when the app closed ("Run again"), offered once per session */
  wasRunning: Record<string, string>
  maximized: boolean
  linkMenu: { x: number; y: number; url: string; root: string } | null
}

export const EMPTY_ROOT: RootTerms = { ids: [], active: null }

export const useTerms = create<TermsState>(() => ({ roots: {}, meta: {}, shells: null, wasRunning: {}, maximized: false, linkMenu: null }))

export function patchMeta(id: string, patch: Partial<TermMeta>): void {
  useTerms.setState((s) => (s.meta[id] ? { meta: { ...s.meta, [id]: { ...s.meta[id], ...patch } } } : {}))
}

export function patchRoot(root: string, fn: (cur: RootTerms) => RootTerms): void {
  useTerms.setState((s) => ({ roots: { ...s.roots, [root]: fn(s.roots[root] ?? EMPTY_ROOT) } }))
}

// ---- default shell (the + button), remembered per user ----

const DEFAULT_KEY = 'dahl.termDefaultShell'

export function getDefaultShell(): ShellKind | null {
  try {
    return (localStorage.getItem(DEFAULT_KEY) as ShellKind | null) ?? null
  } catch {
    return null
  }
}

export function setDefaultShell(id: ShellKind): void {
  try {
    localStorage.setItem(DEFAULT_KEY, id)
  } catch {
    /* storage unavailable */
  }
}

// ---- "Run again": the command running in a project's terminal, so a restart can offer it ----

const runningKey = (root: string): string => `dahl.termRunning:${root}`
const checked = new Set<string>()

export function rememberRunning(root: string, cmd: string | null): void {
  try {
    if (cmd) localStorage.setItem(runningKey(root), cmd)
    else localStorage.removeItem(runningKey(root))
  } catch {
    /* storage unavailable */
  }
}

/** Once per project per session (the panel remounts when hidden or when switching projects). */
export function takeWasRunning(root: string): void {
  if (checked.has(root)) return
  checked.add(root)
  let c: string | null = null
  try {
    c = localStorage.getItem(runningKey(root))
  } catch {
    c = null
  }
  rememberRunning(root, null)
  if (c) useTerms.setState((s) => ({ wasRunning: { ...s.wasRunning, [root]: c } }))
}

export function dismissWasRunning(root: string): void {
  useTerms.setState((s) => {
    if (!(root in s.wasRunning)) return {}
    const { [root]: _gone, ...rest } = s.wasRunning
    return { wasRunning: rest }
  })
}
