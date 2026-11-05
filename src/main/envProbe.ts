import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { childEnv } from './terminal'

// What developer tools this PC has, so the agent knows what it can really do here instead of guessing (seen live: it
// told a user it had "no access to your terminal" and offered `react-native run-ios` on Windows). Probed once and
// cached for 10 minutes; every probe has a short timeout, so a missing tool never slows a task down.

const TOOLS: { name: string; cmd: string; args: string[] }[] = [
  { name: 'Node.js', cmd: 'node', args: ['--version'] },
  { name: 'npm', cmd: 'npm', args: ['--version'] },
  { name: 'git', cmd: 'git', args: ['--version'] },
  { name: 'Python', cmd: 'python', args: ['--version'] },
  { name: 'uv', cmd: 'uv', args: ['--version'] },
  { name: 'Java', cmd: 'java', args: ['-version'] },
  { name: 'adb (Android)', cmd: 'adb', args: ['version'] },
  { name: 'winget', cmd: 'winget', args: ['--version'] },
  { name: '.NET', cmd: 'dotnet', args: ['--version'] },
  { name: 'Docker', cmd: 'docker', args: ['--version'] }
]

function version(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    // shell: true so .cmd shims (npm, many Windows installs) resolve the same way they do in PowerShell
    execFile(cmd, args, { timeout: 4000, windowsHide: true, shell: process.platform === 'win32', env: childEnv() }, (err, out, errOut) => {
      if (err) return resolve(null)
      const line = `${out}\n${errOut}`.split(/\r?\n/).map((l) => l.trim()).find((l) => /\d+\.\d+/.test(l))
      resolve(line ? (/\d+(\.\d+)+/.exec(line)?.[0] ?? 'installed') : 'installed')
    })
  })
}

async function androidSdk(): Promise<string | null> {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')].filter(Boolean) as string[]
  for (const c of candidates) if (await fs.stat(path.join(c, 'platform-tools')).then(() => true, () => false)) return c
  return null
}

let cache: { at: number; text: string } | null = null

/** One short paragraph for the system prompt: what is installed and what is not. */
export async function probeEnvironment(): Promise<string> {
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.text
  const [found, sdk] = await Promise.all([Promise.all(TOOLS.map(async (t) => ({ name: t.name, v: await version(t.cmd, t.args) }))), androidSdk()])
  const have = found.filter((f) => f.v).map((f) => (f.v === 'installed' ? f.name : `${f.name} ${f.v}`))
  const missing = found.filter((f) => !f.v).map((f) => f.name)
  if (sdk) have.push(`Android SDK at ${sdk}${found.find((f) => f.name.startsWith('adb'))?.v ? '' : ` (adb is not on PATH; use ${path.join(sdk, 'platform-tools', 'adb.exe')})`}`)
  else missing.push('Android SDK')
  const text = `Windows ${process.arch} PC. Installed: ${have.join(', ') || 'nothing detected'}. Not found: ${missing.join(', ') || 'none'}.`
  cache = { at: Date.now(), text }
  return text
}
