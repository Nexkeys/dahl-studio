import path from 'node:path'
import type { PrereqStatus, SetupFix } from '@shared/types'
import { androidSdkDir, exists, javaInfo, nodeInstalls, parseSemver, reaNodeOk, whereAll, type NodeInstall } from '../sysProbe'

// Requirements a catalogue connector has beyond its command (checked before it may start, and shown on its card).
// Read-only: a failed check offers fixes the user runs themselves.

export const NODE_LTS_UPGRADE = 'winget upgrade --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements'
const NODE_LTS_INSTALL = 'winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements'
export const JAVA_INSTALL = 'winget install --id EclipseAdoptium.Temurin.17.JDK -e --accept-source-agreements --accept-package-agreements'
export const ADB_INSTALL = 'winget install --id Google.PlatformTools -e --accept-source-agreements --accept-package-agreements'

/** Pure: which Node install REA can use. The first on PATH is what npx runs; a newer one elsewhere is put first. */
export function reaNodeStatus(installs: NodeInstall[]): PrereqStatus {
  const first = installs.find((i) => i.onPath) ?? installs[0]
  const good = installs.find((i) => reaNodeOk(parseSemver(i.version)))
  const nvm = installs.some((i) => /nvm/i.test(i.path))
  if (good && good === first) return { catalogId: 'rea', ok: true, summary: `Node ${good.version} meets REA's requirement`, fixes: [] }
  if (good) {
    return {
      catalogId: 'rea', ok: true, pathDir: path.dirname(good.path),
      summary: `Uses Node ${good.version} from ${path.dirname(good.path)}`,
      detail: `The Node first on PATH${first ? ` (${first.version ?? 'unknown version'}, ${path.dirname(first.path)})` : ''} is too old for REA, so Dahl starts REA with Node ${good.version} instead.`,
      fixes: []
    }
  }
  const fixes: SetupFix[] = [{ label: 'Update Node.js LTS with winget', command: NODE_LTS_UPGRADE }, { label: 'Node.js not installed with winget? Install the LTS', command: NODE_LTS_INSTALL }]
  if (nvm) fixes.push({ label: 'Using nvm-windows: install and switch to Node 24 (nvm use may ask for administrator rights)', command: 'nvm install 24.22.1; nvm use 24.22.1' })
  return {
    catalogId: 'rea', ok: false,
    summary: `Needs Node 22.23.4 or newer${first?.version ? ` (found ${first.version})` : ' (Node.js not found)'}`,
    detail: 'REA 6.8.0 runs on Node ^22.23.4, ^24.22.1 or 26.12.1 and later. REA does not start until this check passes. Restart Dahl Studio after updating Node.',
    fixes
  }
}

/** Places the Maestro CLI is usually unpacked to when it is not on PATH yet. */
function maestroDirs(): string[] {
  return [process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'maestro', 'bin'), process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.maestro', 'bin'), 'C:\\maestro\\bin'].filter(Boolean) as string[]
}

export function maestroStatus(o: { maestro: string | null; onPath: boolean; javaMajor: number | null }): PrereqStatus {
  const fixes: SetupFix[] = []
  const problems: string[] = []
  if (!o.javaMajor || o.javaMajor < 17) {
    problems.push(o.javaMajor ? `Java ${o.javaMajor} is too old (Maestro needs 17 or newer)` : 'Java 17 or newer was not found')
    fixes.push({ label: 'Install Java 17 (Temurin) with winget, then restart Dahl Studio', command: JAVA_INSTALL })
  }
  if (!o.maestro) {
    problems.push('the Maestro CLI was not found')
    fixes.push({ label: 'Download maestro.zip, unzip it (for example to your user folder, so maestro\\bin\\maestro.bat exists), add that bin folder to your user PATH, then restart Dahl Studio', url: 'https://github.com/mobile-dev-inc/maestro/releases/latest/download/maestro.zip' })
  }
  if (problems.length) return { catalogId: 'maestro', ok: false, summary: `Needs setup: ${problems.join('; ')}`, detail: 'Maestro does not start until this check passes.', fixes }
  return {
    catalogId: 'maestro', ok: true, summary: `Maestro CLI found, Java ${o.javaMajor}`,
    detail: o.onPath ? undefined : `Found at ${o.maestro} (not on PATH); Dahl adds that folder for this connector.`,
    pathDir: o.onPath ? undefined : path.dirname(o.maestro!), fixes: []
  }
}

export function mobileMcpStatus(adb: string | null): PrereqStatus {
  if (adb) return { catalogId: 'mobile-mcp', ok: true, summary: `adb found (${adb}). Start an emulator or connect a device before using it.`, fixes: [] }
  return {
    catalogId: 'mobile-mcp', ok: false, summary: 'Needs Android platform-tools (adb)',
    detail: 'Mobile MCP drives devices through adb. See the mobile setup checker below for the full Android setup.',
    fixes: [{ label: 'Install Android platform-tools with winget, then restart Dahl Studio', command: ADB_INSTALL }]
  }
}

async function adbPath(): Promise<string | null> {
  const sdk = (await androidSdkDir()).dir
  const inSdk = sdk ? path.join(sdk, 'platform-tools', 'adb.exe') : null
  if (inSdk && (await exists(inSdk))) return inSdk
  return (await whereAll('adb'))[0] ?? null
}

async function probe(catalogId: string): Promise<PrereqStatus | null> {
  if (catalogId === 'rea') return reaNodeStatus(await nodeInstalls())
  if (catalogId === 'mobile-mcp') return mobileMcpStatus(await adbPath())
  if (catalogId === 'maestro') {
    const onPath = (await whereAll('maestro'))[0] ?? null
    let found = onPath
    for (const d of onPath ? [] : maestroDirs()) if (!found && (await exists(path.join(d, 'maestro.bat')))) found = path.join(d, 'maestro.bat')
    return maestroStatus({ maestro: found, onPath: !!onPath, javaMajor: (await javaInfo()).major })
  }
  return null
}

export const PREREQ_IDS = ['rea', 'mobile-mcp', 'maestro']
const cache = new Map<string, { at: number; status: PrereqStatus }>()

/** Check one connector's prerequisites (cached for a minute; `fresh` re-checks now). Null when it has none. */
export async function checkCatalogPrereq(catalogId: string | undefined, fresh = false): Promise<PrereqStatus | null> {
  if (!catalogId || !PREREQ_IDS.includes(catalogId)) return null
  const hit = cache.get(catalogId)
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.status
  const status = await probe(catalogId)
  if (status) cache.set(catalogId, { at: Date.now(), status })
  return status
}

/** The last known result without probing (for synchronous "needs setup" decisions). */
export function cachedPrereq(catalogId: string | undefined): PrereqStatus | null {
  return (catalogId && cache.get(catalogId)?.status) || null
}

export async function allPrereqs(fresh = false): Promise<Record<string, PrereqStatus>> {
  const out: Record<string, PrereqStatus> = {}
  await Promise.all(PREREQ_IDS.map(async (id) => {
    const s = await checkCatalogPrereq(id, fresh).catch(() => null)
    if (s) out[id] = s
  }))
  return out
}

/** Environment PATH with `dir` first (the key is "Path" on Windows). */
export function withPathFirst(env: NodeJS.ProcessEnv, dir: string): void {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  env[key] = `${dir}${path.delimiter}${env[key] ?? ''}`
}
