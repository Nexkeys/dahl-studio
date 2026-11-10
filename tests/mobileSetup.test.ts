import { describe, it, expect } from 'vitest'
import { evaluateMobile } from '../src/main/mobileCheck'
import type { MobileProbe } from '../src/main/mobileProbe'
import { reaNodeStatus, maestroStatus, mobileMcpStatus } from '../src/main/mcp/prereqs'
import { parseJavaMajor, parseSemver, reaNodeOk } from '../src/main/sysProbe'

const base: MobileProbe = {
  javaMajor: 17, javaPath: 'C:\\jdk\\bin\\java.exe', sdkDir: 'C:\\Users\\u\\AppData\\Local\\Android\\Sdk', sdkSource: 'ANDROID_HOME',
  sdkmanager: 'C:\\sdk\\cmdline-tools\\latest\\bin\\sdkmanager.bat', avdmanager: 'C:\\sdk\\cmdline-tools\\latest\\bin\\avdmanager.bat',
  adb: 'C:\\sdk\\platform-tools\\adb.exe', adbOnPath: true, emulator: 'C:\\sdk\\emulator\\emulator.exe',
  systemImages: ['system-images;android-35;google_apis;x86_64'], avds: ['Pixel_7'], accel: 'WHPX is installed and usable',
  hypervisorPlatform: 'enabled', longPaths: true, ramGb: 16, node: '22.23.4'
}
const by = (checks: ReturnType<typeof evaluateMobile>, id: string) => checks.find((c) => c.id === id)!

describe('mobile setup checker', () => {
  it('passes every check on a fully configured PC', () => {
    const checks = evaluateMobile(base)
    expect(checks.every((c) => c.status === 'pass')).toBe(true)
    expect(checks.map((c) => c.id)).toEqual(['java', 'sdk', 'cmdline', 'adb', 'emulator', 'image', 'avd', 'whpx', 'longpaths', 'ram', 'node'])
  })

  it('fails Java, Hypervisor Platform and long paths with the exact fixes', () => {
    const checks = evaluateMobile({ ...base, javaMajor: 11, hypervisorPlatform: 'disabled', longPaths: false })
    expect(by(checks, 'java').status).toBe('fail')
    expect(by(checks, 'java').fixes[0].command).toContain('EclipseAdoptium.Temurin.17.JDK')
    const whpx = by(checks, 'whpx')
    expect(whpx.status).toBe('fail')
    expect(whpx.fixes.every((f) => f.admin)).toBe(true)
    expect(whpx.fixes.some((f) => f.command?.includes('HypervisorPlatform'))).toBe(true)
    const lp = by(checks, 'longpaths')
    expect(lp.status).toBe('fail')
    expect(lp.fixes[0].admin).toBe(true)
    expect(lp.fixes[0].command).toContain('LongPathsEnabled')
  })

  it('warns when the SDK is only at the default location (ANDROID_HOME unset)', () => {
    const c = by(evaluateMobile({ ...base, sdkSource: 'default location' }), 'sdk')
    expect(c.status).toBe('warn')
    expect(c.fixes[0].command).toContain('ANDROID_HOME')
  })

  it('fails the system image when only a non-x86_64 image is present', () => {
    const c = by(evaluateMobile({ ...base, systemImages: ['system-images;android-35;google_apis;arm64-v8a'] }), 'image')
    expect(c.status).toBe('fail')
    expect(c.fixes[0].command).toContain('sdkmanager')
  })

  it('flags low memory and old Node', () => {
    const checks = evaluateMobile({ ...base, ramGb: 8, node: '18.19.0' })
    expect(by(checks, 'ram').status).toBe('warn')
    expect(by(checks, 'node').status).toBe('fail')
  })
})

describe('connector prerequisites', () => {
  it('REA needs Node 22.23.4+ and reports too-old Node', () => {
    const bad = reaNodeStatus([{ path: 'C:\\nvm\\node.exe', version: '22.22.3', onPath: true }])
    expect(bad.ok).toBe(false)
    expect(bad.summary).toContain('22.23.4')
    expect(bad.fixes.some((f) => f.command?.includes('OpenJS.NodeJS.LTS'))).toBe(true)
  })

  it('REA uses a newer Node found off PATH instead of the old one first on PATH', () => {
    const s = reaNodeStatus([
      { path: 'C:\\nvm\\node.exe', version: '22.22.3', onPath: true },
      { path: 'C:\\Program Files\\nodejs\\node.exe', version: '26.13.0', onPath: false }
    ])
    expect(s.ok).toBe(true)
    expect(s.pathDir?.toLowerCase()).toContain('program files')
  })

  it('REA is happy when the Node first on PATH already meets the range', () => {
    const s = reaNodeStatus([{ path: 'C:\\nodejs\\node.exe', version: '24.22.1', onPath: true }])
    expect(s.ok).toBe(true)
    expect(s.pathDir).toBeUndefined()
  })

  it('Maestro needs the CLI and Java 17', () => {
    expect(maestroStatus({ maestro: null, onPath: false, javaMajor: 11 }).ok).toBe(false)
    const ok = maestroStatus({ maestro: 'C:\\maestro\\bin\\maestro.bat', onPath: false, javaMajor: 17 })
    expect(ok.ok).toBe(true)
    expect(ok.pathDir).toContain('maestro')
  })

  it('Mobile MCP needs adb', () => {
    expect(mobileMcpStatus(null).ok).toBe(false)
    expect(mobileMcpStatus('C:\\sdk\\platform-tools\\adb.exe').ok).toBe(true)
  })

  it('parses java and node versions and the REA range', () => {
    expect(parseJavaMajor('java version "1.8.0_392"')).toBe(8)
    expect(parseJavaMajor('openjdk version "17.0.9" 2023')).toBe(17)
    expect(parseJavaMajor('java version "26.0.2" 2026-07-21')).toBe(26)
    expect(reaNodeOk(parseSemver('22.22.3'))).toBe(false)
    expect(reaNodeOk(parseSemver('22.23.4'))).toBe(true)
    expect(reaNodeOk(parseSemver('24.21.0'))).toBe(false)
    expect(reaNodeOk(parseSemver('26.13.0'))).toBe(true)
  })
})
