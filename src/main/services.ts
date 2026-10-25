import { app, safeStorage, type BrowserWindow } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import type { KeyInfo, KeySlot } from '@shared/types'
import { PROVIDER_OF_SLOT } from '@shared/types'
import { SettingsStore } from './settings'
import { SecretVault } from './secrets'
import { UsageLedger } from './dahl/usage'
import { ModelRegistry, PROVIDER_INFO } from './providers/registry'
import { ProcessManager } from './terminal'
import { AgentRunner } from './agent/runner'
import { ReasoningStore } from './store/reasoning'
import { McpManager } from './mcp/manager'
import { webFetch, webSearch } from './tools/web'
import { formatBreakdown, PIXEL_ANALYSIS_JS, windowsOcr } from './tools/image'
import { appendJsonl, nowIso, redact } from './util'

export const localAppData = process.env.LOCALAPPDATA ?? app.getPath('appData')
// Smoke tests use an isolated profile so they never touch the user's real settings and can run beside the installed app
app.setPath('userData', process.env.DAHL_SMOKE ? path.join(process.env.DAHL_SMOKE, 'profile') : path.join(localAppData, 'DahlStudio'))
export const APP_DIR = app.getPath('userData')
export const LOG_FILE = path.join(APP_DIR, 'logs', 'main.jsonl')
export const ALL_SLOTS: KeySlot[] = ['primary', 'secondary', 'openai', 'anthropic', 'gemini', 'nvidia']

export const win: { current: BrowserWindow | null } = { current: null }
export function send(channel: string, payload: unknown): void {
  const w = win.current
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}

export const settings = new SettingsStore(APP_DIR)
export const vault = new SecretVault(APP_DIR, safeStorage)
export const usage = new UsageLedger(APP_DIR)
export const procs = new ProcessManager()
export const reasoning = new ReasoningStore(APP_DIR)

export const health: Record<string, Pick<KeyInfo, 'health' | 'lastError' | 'lastCheckedAt'>> = Object.fromEntries(ALL_SLOTS.map((s) => [s, { health: 'unknown' }]))

export async function log(level: 'info' | 'error', msg: string, extra?: unknown): Promise<void> {
  const secrets = await vault.allValues().catch(() => [])
  await appendJsonl(LOG_FILE, { at: nowIso(), level, msg: redact(msg, secrets), extra: extra ? redact(JSON.stringify(extra), secrets) : undefined }).catch(() => {})
}

export async function keyInfos(): Promise<KeyInfo[]> {
  const s = await settings.get()
  const out: KeyInfo[] = []
  for (const slot of ALL_SLOTS) out.push({ slot, provider: PROVIDER_OF_SLOT[slot], name: s.keyNames[slot], configured: await vault.has(slot), ...health[slot] })
  return out
}

export const models = new ModelRegistry({
  appDir: APP_DIR,
  getKey: (s) => vault.get(s),
  getPreferred: async () => (await settings.get()).preferredKey,
  onUsage: (slot, u) => void usage.record(slot, u).then(async () => send('usage:changed', await usage.get())),
  onHealth: (slot, h, err) => {
    health[slot] = { health: h, lastError: err ? redact(err) : undefined, lastCheckedAt: nowIso() }
    void keyInfos().then((k) => send('keys:changed', k))
  },
  onModels: (m) => send('models:changed', m)
})

/** Bundled MCP servers run with Electron's Node (ELECTRON_RUN_AS_NODE). In a packaged app they live in app.asar.unpacked. */
export function bundledEntry(name: string): string | null {
  const rel: Record<string, string> = {
    filesystem: 'node_modules/@modelcontextprotocol/server-filesystem/dist/index.js',
    playwright: 'node_modules/@playwright/mcp/cli.js'
  }
  if (!rel[name]) return null
  return path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), rel[name])
}

export const mcp = new McpManager({
  appDir: APP_DIR,
  bundledEntry,
  getSecret: (n) => vault.get(n),
  setSecret: (n, v) => vault.set(n, v),
  onChange: () => void mcp.list().then((l) => send('mcp:changed', l))
})

/** Image breakdown: canvas pixel analysis in the renderer + Windows OCR + optional vision-model description. */
async function analyzeImage(name: string, mediaType: string, data: string, signal: AbortSignal): Promise<string> {
  let px: unknown = null
  try {
    px = await win.current?.webContents.executeJavaScript(PIXEL_ANALYSIS_JS(`data:${mediaType};base64,${data}`), true)
  } catch (e) {
    px = null
    void log('error', `pixel analysis failed: ${(e as Error).message}`)
  }
  let ocr: Awaited<ReturnType<typeof windowsOcr>> | string
  const tmp = path.join(os.tmpdir(), `dahl-img-${Date.now()}.${mediaType.split('/')[1] ?? 'png'}`)
  try {
    await fs.writeFile(tmp, Buffer.from(data, 'base64'))
    ocr = await windowsOcr(tmp)
  } catch (e) {
    ocr = (e as Error).message
  } finally {
    void fs.rm(tmp, { force: true })
  }
  // A vision-capable model from a provider the user configured (never sends anything if none is configured)
  let vision: string | undefined
  for (const m of await visionCandidates()) {
    try {
      const r = await models.chat({ model: m.key, vision: true, messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe this image in precise detail for a developer who cannot see it: layout and sections from top to bottom, every UI element, all visible text, colours (hex estimates), typography, spacing and style. Be exhaustive but structured.' }, { type: 'image', mediaType, data, name }] }] }, signal)
      vision = `(${m.label}) ${r.content}`
      break
    } catch (e) {
      if ((e as Error).name === 'DahlError' && (e as { kind?: string }).kind === 'cancelled') break
      visionFailed.add(m.key) // never retry this model again in this session
      void log('info', `vision assist: ${m.key} unavailable (${(e as Error).message.slice(0, 160)}); trying the next option`)
    }
  }
  return formatBreakdown(name, px, ocr, vision)
}

const visionFailed = new Set<string>()
const PREFERRED_VISION: [string, RegExp, RegExp?][] = [
  ['anthropic', /claude-(sonnet|opus|haiku)/i],
  ['openai', /^(gpt-4o|gpt-4\.1|gpt-5)/i, /(mini-tts|audio|realtime|search)/i],
  ['gemini', /gemini-[\d.]+-flash/i, /(image|tts|live|lite-preview|thinking-exp)/i],
  ['nvidia', /(llama-4|llama-3\.2-\d+b-vision|phi-4-multimodal|gemma-3)/i, /fuyu|kosmos|neva|vila/i]
]

/**
 * Pick at most 2 vision models to try: the user's selected model first (if it accepts images), then one well-known
 * vision model per configured provider. Skips providers whose key is known to be failing and models that already failed.
 */
async function visionCandidates(): Promise<{ key: string; label: string }[]> {
  const list = (await models.list()).models.filter((m) => m.vision && !visionFailed.has(m.key))
  const out: { key: string; label: string }[] = []
  const current = (await settings.get()).defaultModel
  const selected = list.find((m) => m.key === current)
  if (selected) out.push(selected)
  for (const [p, good, bad] of PREFERRED_VISION) {
    const slot = PROVIDER_INFO[p as keyof typeof PROVIDER_INFO].slot
    if (!(await vault.has(slot)) || ['auth_failed', 'exhausted'].includes(health[slot]?.health)) continue
    const m = list.filter((x) => x.provider === p && good.test(x.id) && !(bad && bad.test(x.id))).sort((a, b) => b.id.localeCompare(a.id))[0]
    if (m && !out.some((o) => o.key === m.key)) out.push(m)
  }
  return out.slice(0, 2)
}

export const runner = new AgentRunner({
  backend: models,
  getSettings: () => settings.get(),
  emit: (e) => {
    send('agent:event', e)
    void import('./notify').then((m) => m.notifyAgentEvent(e)).catch(() => {})
  },
  runCommand: (cmd, cwd, t, sig) => procs.run(cmd, cwd, t, sig),
  secrets: () => vault.allValues(),
  reasoning: async (project) => reasoning.resolve((await settings.get()).projectReasoning[project]),
  modelVision: async (m) => (await models.find(m))?.vision ?? false,
  web: { search: (q, max, sig) => webSearch(q, sig, max), fetch: (u, sig) => webFetch(u, sig) },
  analyzeImage,
  mcp: { toolsFor: (p) => mcp.toolsFor(p), call: (s, p, t, a) => mcp.call(s, p, t, a) }
})
