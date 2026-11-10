import path from 'node:path'
import { existsSync } from 'node:fs'
import type { ShellInfo, ShellKind } from '@shared/types'

// Shell detection for the terminal's + menu: PowerShell 7 (pwsh), Windows PowerShell, Command Prompt and Git Bash.
// Pure (environment and file check injected), so the rules are tested without touching this PC.

type Env = Record<string, string | undefined>
const win = path.win32

/** Windows environment names are case-insensitive, a plain copy of process.env is not. */
export function envGet(env: Env, name: string): string | undefined {
  const k = Object.keys(env).find((x) => x.toLowerCase() === name.toLowerCase())
  return k ? env[k] : undefined
}

export function pathDirs(env: Env): string[] {
  return (envGet(env, 'PATH') ?? '').split(';').map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean)
}

/** First PATH directory holding `exe`, skipping folders `skip` rejects. */
export function findOnPath(exe: string, dirs: string[], exists: (p: string) => boolean, skip?: (dir: string) => boolean): string | null {
  for (const d of dirs) {
    if (skip?.(d)) continue
    const p = win.join(d, exe)
    if (exists(p)) return p
  }
  return null
}

/** The Git for Windows install folder from a PATH entry (Git\cmd, Git\bin, Git\usr\bin, Git\mingw64\bin). */
export function gitRootFromDir(dir: string): string | null {
  const d = win.normalize(dir).replace(/\\+$/, '')
  if (/\\(mingw64|mingw32|usr)\\bin$/i.test(d)) return win.dirname(win.dirname(d))
  if (/\\(cmd|bin)$/i.test(d)) return win.dirname(d)
  return null
}

// WSL's bash.exe (System32, WindowsApps) is not Git Bash
const isWslDir = (d: string): boolean => /\\(system32|sysnative|windowsapps)\\?$/i.test(d)

export function detectShells(env: Env, exists: (p: string) => boolean): ShellInfo[] {
  const dirs = pathDirs(env)
  const sysRoot = envGet(env, 'SystemRoot') ?? envGet(env, 'windir') ?? 'C:\\Windows'
  const programFiles = [envGet(env, 'ProgramW6432'), envGet(env, 'ProgramFiles'), envGet(env, 'ProgramFiles(x86)')].filter((x): x is string => !!x)
  const localApp = envGet(env, 'LOCALAPPDATA')
  const first = (...c: (string | null | undefined)[]): string | null => c.find((p): p is string => !!p && exists(p)) ?? null

  const found: [ShellKind, string, string | null][] = [
    ['pwsh', 'PowerShell 7', first(
      findOnPath('pwsh.exe', dirs, exists),
      ...programFiles.flatMap((pf) => [win.join(pf, 'PowerShell', '7', 'pwsh.exe'), win.join(pf, 'PowerShell', '7-preview', 'pwsh.exe')]),
      localApp && win.join(localApp, 'Microsoft', 'WindowsApps', 'pwsh.exe')
    )],
    ['powershell', 'Windows PowerShell', first(win.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), findOnPath('powershell.exe', dirs, exists))],
    ['cmd', 'Command Prompt', first(envGet(env, 'ComSpec'), win.join(sysRoot, 'System32', 'cmd.exe'))],
    ['gitbash', 'Git Bash', first(
      ...dirs.filter((d) => !isWslDir(d)).map(gitRootFromDir).map((r) => r && win.join(r, 'bin', 'bash.exe')),
      ...programFiles.map((pf) => win.join(pf, 'Git', 'bin', 'bash.exe')),
      localApp && win.join(localApp, 'Programs', 'Git', 'bin', 'bash.exe'),
      envGet(env, 'USERPROFILE') && win.join(envGet(env, 'USERPROFILE')!, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe')
    )]
  ]
  return found.filter(([, , p]) => p).map(([id, name, p]) => ({ id, name, path: p! }))
}

let cache: ShellInfo[] | null = null

/** Shells on this PC (cached for the session; detection is a handful of file checks). */
export function getShells(): ShellInfo[] {
  if (cache) return cache
  if (process.platform !== 'win32') return (cache = [{ id: 'gitbash', name: 'Shell', path: process.env.SHELL || '/bin/bash' }])
  return (cache = detectShells(process.env, (p) => existsSync(p)))
}

/** Windows build number (22631 for 11 23H2), which xterm.js uses to match ConPTY's line wrapping. */
export function windowsBuild(release: string): number {
  const n = Number(release.split('.')[2])
  return Number.isFinite(n) ? n : 0
}
