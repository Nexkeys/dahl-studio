import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { androidSdkDir, exists, javaInfo, longPathsEnabled, nodeInstalls, runQuiet, whereAll, windowsFeature } from './sysProbe'

/** Raw facts about this PC's Android setup. Gathered read-only; mobileCheck.ts turns them into pass/fail with fixes. */
export interface MobileProbe {
  javaMajor: number | null
  javaPath: string | null
  sdkDir: string | null
  /** where the SDK was found: ANDROID_HOME, ANDROID_SDK_ROOT or the default location */
  sdkSource: string | null
  sdkmanager: string | null
  avdmanager: string | null
  adb: string | null
  adbOnPath: boolean
  emulator: string | null
  /** sdkmanager package ids, e.g. "system-images;android-35;google_apis;x86_64" */
  systemImages: string[]
  avds: string[]
  /** first line of `emulator -accel-check` mentioning the accelerator, when the emulator is installed */
  accel: string | null
  hypervisorPlatform: 'enabled' | 'disabled' | 'unknown'
  longPaths: boolean | null
  ramGb: number
  node: string | null
}

const dirs = (p: string): Promise<string[]> => fs.readdir(p, { withFileTypes: true }).then((e) => e.filter((x) => x.isDirectory()).map((x) => x.name), () => [])

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) if (await exists(p)) return p
  return null
}

/** cmdline-tools/latest first, then any other cmdline-tools version, then the old tools/bin. */
async function sdkTool(sdk: string, name: string): Promise<string | null> {
  const versions = (await dirs(path.join(sdk, 'cmdline-tools'))).sort((a, b) => (a === 'latest' ? -1 : b === 'latest' ? 1 : b.localeCompare(a)))
  return firstExisting([...versions.map((v) => path.join(sdk, 'cmdline-tools', v, 'bin', `${name}.bat`)), path.join(sdk, 'tools', 'bin', `${name}.bat`)])
}

async function systemImages(sdk: string): Promise<string[]> {
  const out: string[] = []
  for (const api of await dirs(path.join(sdk, 'system-images')))
    for (const tag of await dirs(path.join(sdk, 'system-images', api)))
      for (const abi of await dirs(path.join(sdk, 'system-images', api, tag))) out.push(`system-images;${api};${tag};${abi}`)
  return out
}

async function avds(): Promise<string[]> {
  const home = process.env.ANDROID_AVD_HOME ?? path.join(process.env.ANDROID_USER_HOME ?? path.join(os.homedir(), '.android'), 'avd')
  const files = await fs.readdir(home).catch(() => [] as string[])
  return files.filter((f) => f.endsWith('.ini')).map((f) => f.slice(0, -4))
}

export async function probeMobile(): Promise<MobileProbe> {
  const { dir: sdk, source } = await androidSdkDir()
  const [java, node, hv, lp, adbPath] = await Promise.all([javaInfo(), nodeInstalls(), windowsFeature('HypervisorPlatform'), longPathsEnabled(), whereAll('adb')])
  const adbInSdk = sdk ? await firstExisting([path.join(sdk, 'platform-tools', 'adb.exe')]) : null
  const emulator = sdk ? await firstExisting([path.join(sdk, 'emulator', 'emulator.exe')]) : null
  let accel: string | null = null
  if (emulator) {
    const r = await runQuiet(emulator, ['-accel-check'], 15000)
    accel = r.out.split(/\r?\n/).map((l) => l.trim()).find((l) => /WHPX|HAXM|AEHD|accel/i.test(l) && !/^accel:?$/i.test(l)) ?? null
  }
  return {
    javaMajor: java.major, javaPath: java.path, sdkDir: sdk, sdkSource: source,
    sdkmanager: sdk ? await sdkTool(sdk, 'sdkmanager') : null, avdmanager: sdk ? await sdkTool(sdk, 'avdmanager') : null,
    adb: adbInSdk ?? adbPath[0] ?? null, adbOnPath: adbPath.length > 0, emulator,
    systemImages: sdk ? await systemImages(sdk) : [], avds: await avds(), accel,
    hypervisorPlatform: hv, longPaths: lp, ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    node: (node.find((n) => n.onPath) ?? node[0])?.version ?? null
  }
}
