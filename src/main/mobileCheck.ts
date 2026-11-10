import path from 'node:path'
import type { MobileCheck, SetupFix } from '@shared/types'
import { probeMobile, type MobileProbe } from './mobileProbe'
import { ADB_INSTALL, JAVA_INSTALL, NODE_LTS_UPGRADE } from './mcp/prereqs'
import { parseSemver, reaNodeOk } from './sysProbe'

// Mobile setup checker: what Android development (Expo, React Native, Gradle, the mobile connectors) needs on this PC.
// Every check is read-only. Fixes are shown to the user; administrator steps are marked and never run by Dahl.

const DEFAULT_IMAGE = 'system-images;android-35;google_apis;x86_64'
const ANDROID_STUDIO = 'winget install --id Google.AndroidStudio -e --accept-source-agreements --accept-package-agreements'
const q = (p: string): string => `"${p}"`
const addUserPath = (dir: string): string => `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';${dir}', 'User')`

function sdkFix(p: MobileProbe, pkg: string, what: string): SetupFix[] {
  if (p.sdkmanager) return [{ label: `Install ${what} with sdkmanager (if it asks about licences, run "sdkmanager --licenses" in your own terminal first)`, command: `& ${q(p.sdkmanager)} ${q(pkg)}` }]
  return [{ label: `Install ${what} from Android Studio: Settings > Languages & Frameworks > Android SDK (or install the command-line tools first, see above)` }]
}

/** Pure: turn probed facts into checks with exact fixes. */
export function evaluateMobile(p: MobileProbe): MobileCheck[] {
  const out: MobileCheck[] = []
  const add = (id: string, label: string, status: MobileCheck['status'], detail: string, fixes: SetupFix[] = []): void => void out.push({ id, label, status, detail, fixes })

  if (p.javaMajor && p.javaMajor >= 17) add('java', 'Java 17 or newer', 'pass', `Java ${p.javaMajor}${p.javaPath ? ` (${p.javaPath})` : ''}`)
  else add('java', 'Java 17 or newer', 'fail', p.javaMajor ? `Java ${p.javaMajor} is too old: Gradle and Maestro need 17 or newer.` : 'No Java found on PATH or in JAVA_HOME.', [{ label: 'Install Java 17 (Temurin) with winget, then restart Dahl Studio', command: JAVA_INSTALL }])

  if (!p.sdkDir) {
    add('sdk', 'Android SDK', 'fail', 'No SDK in ANDROID_HOME, ANDROID_SDK_ROOT or %LOCALAPPDATA%\\Android\\Sdk.', [
      { label: 'Install Android Studio with winget, open it once and finish the setup wizard (it installs the SDK)', command: ANDROID_STUDIO }
    ])
  } else if (p.sdkSource === 'default location') {
    add('sdk', 'Android SDK', 'warn', `Found at ${p.sdkDir}, but ANDROID_HOME is not set (Gradle and Expo look for it).`, [
      { label: 'Set ANDROID_HOME for your user account, then restart Dahl Studio', command: `[Environment]::SetEnvironmentVariable('ANDROID_HOME', '${p.sdkDir}', 'User')` }
    ])
  } else add('sdk', 'Android SDK', 'pass', `${p.sdkDir} (from ${p.sdkSource})`)

  if (p.sdkDir) {
    if (p.sdkmanager) add('cmdline', 'SDK command-line tools (sdkmanager)', 'pass', p.sdkmanager)
    else add('cmdline', 'SDK command-line tools (sdkmanager)', 'warn', 'sdkmanager and avdmanager are missing, so SDK packages cannot be installed from a terminal.', [
      { label: 'In Android Studio: Settings > Languages & Frameworks > Android SDK > SDK Tools, tick "Android SDK Command-line Tools (latest)", then Apply' }
    ])
  }

  const pt = p.sdkDir ? path.join(p.sdkDir, 'platform-tools') : null
  if (!p.adb) add('adb', 'Platform-tools (adb)', 'fail', 'adb was not found.', p.sdkmanager ? sdkFix(p, 'platform-tools', 'platform-tools') : [{ label: 'Install Android platform-tools with winget', command: ADB_INSTALL }])
  else if (!p.adbOnPath && pt) add('adb', 'Platform-tools (adb)', 'warn', `${p.adb} is installed but not on PATH, so "adb" does not work in a terminal.`, [{ label: 'Add platform-tools to your user PATH, then restart Dahl Studio', command: addUserPath(pt) }])
  else add('adb', 'Platform-tools (adb)', 'pass', p.adb)

  if (p.emulator) add('emulator', 'Android emulator', 'pass', p.emulator)
  else add('emulator', 'Android emulator', 'fail', p.sdkDir ? 'The emulator package is not installed.' : 'Needs the Android SDK first.', p.sdkDir ? sdkFix(p, 'emulator', 'the emulator') : [])

  const x86 = p.systemImages.filter((i) => /;x86_64$/.test(i))
  if (x86.length) add('image', 'Emulator system image (x86_64)', 'pass', x86.join(', '))
  else add('image', 'Emulator system image (x86_64)', 'fail', p.systemImages.length ? `Only non-x86_64 images: ${p.systemImages.join(', ')}` : 'No system image installed.', p.sdkDir ? sdkFix(p, DEFAULT_IMAGE, 'an Android 15 image') : [])

  const image = x86[0] ?? DEFAULT_IMAGE
  if (p.avds.length) add('avd', 'Virtual device (AVD)', 'pass', p.avds.join(', '))
  else add('avd', 'Virtual device (AVD)', 'fail', 'No virtual device has been created.', p.avdmanager
    ? [{ label: `Create a Pixel 7 device from ${image}`, command: `echo no | & ${q(p.avdmanager)} create avd -n Dahl_Pixel_7 -k ${q(image)} -d pixel_7` }]
    : [{ label: 'In Android Studio: More Actions > Virtual Device Manager > Create device' }])

  const accel = p.accel ? ` Emulator says: ${p.accel}` : ''
  if (p.hypervisorPlatform === 'enabled') add('whpx', 'Windows Hypervisor Platform', 'pass', `Enabled.${accel}`)
  else add('whpx', 'Windows Hypervisor Platform', p.hypervisorPlatform === 'disabled' ? 'fail' : 'warn', `${p.hypervisorPlatform === 'disabled' ? 'Disabled: the emulator runs very slowly or not at all without it.' : 'Could not read the feature state.'}${accel}`, [
    { label: 'Administrator step (you do this): open "Turn Windows features on or off", tick "Windows Hypervisor Platform", click OK, then restart Windows', admin: true },
    { label: 'Or in an administrator PowerShell, then restart Windows', command: 'Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All', admin: true }
  ])

  if (p.longPaths) add('longpaths', 'Long paths enabled', 'pass', 'LongPathsEnabled = 1')
  else add('longpaths', 'Long paths enabled', 'fail', 'Off: deep node_modules and Gradle build folders can fail with path-too-long errors.', [
    { label: 'Administrator step (you do this): in an administrator PowerShell, then restart Windows', command: "New-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force", admin: true }
  ])

  const ram = `${p.ramGb} GB of memory`
  if (p.ramGb >= 15) add('ram', 'Memory (16 GB recommended)', 'pass', ram)
  else add('ram', 'Memory (16 GB recommended)', p.ramGb >= 8 ? 'warn' : 'fail', `${ram}: the emulator, Gradle and a dev server together want about 16 GB. Close other apps while the emulator runs, or give the virtual device less memory.`)

  const nv = parseSemver(p.node)
  const rea = reaNodeOk(nv) ? '' : ' REA needs 22.23.4 or newer (see its card).'
  if (nv && nv[0] >= 20) add('node', 'Node.js 20 or newer', 'pass', `Node ${p.node}.${rea}`)
  else add('node', 'Node.js 20 or newer', 'fail', p.node ? `Node ${p.node} is too old for Expo and Mobile MCP.` : 'Node.js was not found.', [{ label: 'Update Node.js LTS with winget, then restart Dahl Studio', command: NODE_LTS_UPGRADE }])
  return out
}

export async function runMobileChecks(): Promise<MobileCheck[]> {
  return evaluateMobile(await probeMobile())
}
