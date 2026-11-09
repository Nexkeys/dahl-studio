import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { childEnv } from './terminal'

// Read-only probes of this PC (versions, paths, Windows features) for connector prerequisites and the mobile setup
// checker. Nothing here changes the system: every call reads a version, a file or a setting, with a short timeout.

export interface ExecOut { ok: boolean; out: string }

/** Run a program and capture stdout + stderr (java -version prints to stderr). Never throws. */
export function runQuiet(cmd: string, args: string[], timeoutMs = 6000, shell = false): Promise<ExecOut> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, shell, env: childEnv() }, (err, out, errOut) => resolve({ ok: !err, out: `${out ?? ''}\n${errOut ?? ''}`.trim() }))
    } catch (e) {
      resolve({ ok: false, out: (e as Error).message })
    }
  })
}

export const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false)

/** Every match for a program on PATH, in PATH order (Windows `where`). */
export async function whereAll(exe: string): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const r = await runQuiet('where.exe', [exe], 4000)
  return r.ok ? r.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[a-z]:\\/i.test(l)) : []
}

export type Semver = [number, number, number]

export function parseSemver(s: string | null | undefined): Semver | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(s ?? '')
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function semverGte(a: Semver, b: Semver): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}

/** REA (rea-agents 6.8.0) engines: ^22.23.4 || ^24.22.1 || >=26.12.1 */
export const REA_NODE_RANGE = '^22.23.4 || ^24.22.1 || >=26.12.1'
export function reaNodeOk(v: Semver | null): boolean {
  if (!v) return false
  if (v[0] === 22) return semverGte(v, [22, 23, 4])
  if (v[0] === 24) return semverGte(v, [24, 22, 1])
  return v[0] >= 26 && semverGte(v, [26, 12, 1])
}

/** Java major version from `java -version` output: "1.8.0_392" is 8, "17.0.9" is 17, "26.0.2" is 26. */
export function parseJavaMajor(out: string): number | null {
  const m = /version "?(\d+)(?:\.(\d+))?/i.exec(out)
  if (!m) return null
  const major = Number(m[1])
  return major === 1 && m[2] ? Number(m[2]) : major
}

export interface NodeInstall { path: string; version: string | null; onPath: boolean }

/**
 * Every Node.js install we can find: all `node.exe` on PATH (first one is what `npx` uses) plus the default
 * installer location, which a version manager (nvm-windows) can shadow on PATH.
 */
export async function nodeInstalls(): Promise<NodeInstall[]> {
  const onPath = await whereAll('node')
  const extra = process.env.ProgramFiles ? [path.join(process.env.ProgramFiles, 'nodejs', 'node.exe')] : []
  const all: NodeInstall[] = []
  for (const p of [...onPath, ...extra]) {
    if (all.some((x) => x.path.toLowerCase() === p.toLowerCase()) || !(await exists(p))) continue
    const r = await runQuiet(p, ['--version'], 4000)
    all.push({ path: p, version: r.ok ? (parseSemver(r.out)?.join('.') ?? null) : null, onPath: onPath.some((x) => x.toLowerCase() === p.toLowerCase()) })
  }
  return all
}

/** First `java` on PATH, else JAVA_HOME\bin\java.exe. */
export async function javaInfo(): Promise<{ path: string | null; major: number | null; raw: string }> {
  const candidates = [...(await whereAll('java')), ...(process.env.JAVA_HOME ? [path.join(process.env.JAVA_HOME, 'bin', 'java.exe')] : [])]
  for (const p of candidates) {
    if (!(await exists(p))) continue
    const r = await runQuiet(p, ['-version'], 6000)
    const major = parseJavaMajor(r.out)
    if (major) return { path: p, major, raw: r.out.split(/\r?\n/)[0] ?? '' }
  }
  return { path: null, major: null, raw: '' }
}

/** Android SDK folder: ANDROID_HOME, ANDROID_SDK_ROOT, then the Android Studio default. */
export async function androidSdkDir(): Promise<{ dir: string | null; source: string | null }> {
  const c: [string | undefined, string][] = [
    [process.env.ANDROID_HOME, 'ANDROID_HOME'], [process.env.ANDROID_SDK_ROOT, 'ANDROID_SDK_ROOT'],
    [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'), 'default location']
  ]
  for (const [d, source] of c) if (d && (await exists(d))) return { dir: d, source }
  return { dir: null, source: null }
}

/** Windows optional feature state without administrator rights (Win32_OptionalFeature: 1 enabled, 2 disabled). */
export async function windowsFeature(name: string): Promise<'enabled' | 'disabled' | 'unknown'> {
  if (process.platform !== 'win32') return 'unknown'
  const r = await runQuiet('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_OptionalFeature -Filter "Name='${name.replace(/[^\w-]/g, '')}'").InstallState`], 15000)
  const state = Number(r.out.trim().split(/\r?\n/).pop())
  return state === 1 ? 'enabled' : state === 2 ? 'disabled' : 'unknown'
}

/** HKLM\SYSTEM\CurrentControlSet\Control\FileSystem LongPathsEnabled, read with reg.exe (no rights needed). */
export async function longPathsEnabled(): Promise<boolean | null> {
  if (process.platform !== 'win32') return null
  const r = await runQuiet('reg.exe', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled'], 5000)
  const m = /LongPathsEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(r.out)
  // a missing value means the default, which is off
  return m ? parseInt(m[1], 16) === 1 : false
}
