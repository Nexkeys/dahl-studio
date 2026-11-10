import { app, safeStorage, type BrowserWindow } from 'electron'
import path from 'node:path'
import type { KeyInfo, KeySlot } from '@shared/types'
import { PROVIDER_OF_SLOT } from '@shared/types'
import { LOCAL_DEFAULT_URL, normalizeLocalBase } from '@shared/models'
import { SettingsStore } from './settings'
import { SecretVault } from './secrets'
import { UsageLedger } from './dahl/usage'
import { CostLedger } from './costLedger'
import { ModelRegistry, PROVIDER_INFO } from './providers/registry'
import { ProcessManager } from './terminal'
import { AgentRunner } from './agent/runner'
import { ReasoningStore } from './store/reasoning'
import { McpManager } from './mcp/manager'
import { webFetch, webSearch } from './tools/web'
import { createImaging } from './vision/imaging'
import { appendJsonl, nowIso, redact } from './util'
import { probeEnvironment } from './envProbe'
import { batchDeltas } from './eventBatch'
import { PreviewController } from './preview/controller'
import { createSkillService } from './skills/service'
import { configureChief } from './chief/tools'

export const localAppData = process.env.LOCALAPPDATA ?? app.getPath('appData')
// Smoke tests use an isolated profile so they never touch the user's real settings and can run beside the installed app
app.setPath('userData', process.env.DAHL_SMOKE ? path.join(process.env.DAHL_SMOKE, 'profile') : path.join(localAppData, 'DahlStudio'))
export const APP_DIR = app.getPath('userData')
export const LOG_FILE = path.join(APP_DIR, 'logs', 'main.jsonl')
export const ALL_SLOTS: KeySlot[] = ['primary', 'secondary', 'openai', 'anthropic', 'gemini', 'nvidia', 'groq', 'openrouter']

export const win: { current: BrowserWindow | null } = { current: null }
export function send(channel: string, payload: unknown): void {
  const w = win.current
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}

export const settings = new SettingsStore(APP_DIR)
export const vault = new SecretVault(APP_DIR, safeStorage)
export const usage = new UsageLedger(APP_DIR)
export const costs = new CostLedger(APP_DIR)
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
  // every request is also priced into today's spend (costLedger.ts); the per-request log keeps its cost
  onUsage: (slot, u) => void costs.record(PROVIDER_OF_SLOT[slot] ?? slot, u).catch(() => null)
    .then((c) => usage.record(slot, c && c.usd !== null ? { ...u, costUsd: c.usd, costExact: c.exact } : u))
    .then(async () => send('usage:changed', await usage.get())),
  onHealth: (slot, h, err) => {
    health[slot] = { health: h, lastError: err ? redact(err) : undefined, lastCheckedAt: nowIso() }
    void keyInfos().then((k) => send('keys:changed', k))
  },
  onModels: (m) => send('models:changed', m),
  getLocalBase: async (p) => normalizeLocalBase((await settings.get()).localUrls?.[p] ?? '') ?? LOCAL_DEFAULT_URL[p]
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

/**
 * Images and PDFs (vision/imaging.ts): OCR with layout, automatic reading of attachments, vision routing. A provider
 * is only used when its key is configured and not known to be failing (groq/openrouter: by slot name, when present).
 */
export const imaging = createImaging({
  appDir: APP_DIR,
  models: async () => (await models.list()).models,
  findModel: async (k) => (await models.find(k)) ?? undefined,
  chat: (req, signal) => models.chat(req, signal),
  providerUsable: async (p) => {
    const slot = (PROVIDER_INFO as Record<string, { slot: string } | undefined>)[p]?.slot ?? p
    return (await vault.has(slot as KeySlot)) && !['auth_failed', 'exhausted'].includes(health[slot]?.health)
  },
  settings: () => settings.get(),
  log: (level, msg) => void log(level, msg)
})

/** The Preview pane's page, for the agent's browser_* tools (the guest is handed over in index.ts). */
export const preview = new PreviewController({
  show: (root, url) => send('preview:open', { root, url }),
  activeProject: async () => (await settings.get()).activeProject,
  log: (m) => void log('info', m)
})
/** Built-in skills: the top-level skills/ folder (extraResources in the installed app, the repo in development). */
export const builtinSkillsDir = (): string => (app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(app.getAppPath(), 'skills'))
export const skills = createSkillService({ builtinDir: builtinSkillsDir, userDir: path.join(APP_DIR, 'skills'), log: (m) => void log('info', m) })

const sendAgentEvent = batchDeltas((e) => send('agent:event', e))
export const runner = new AgentRunner({
  backend: models,
  getSettings: () => settings.get(),
  emit: (e) => {
    sendAgentEvent(e)
    if (e.type !== 'delta' && e.type !== 'reasoning_delta') void import('./notify').then((m) => m.notifyAgentEvent(e)).catch(() => {})
  },
  runCommand: (cmd, cwd, t, sig) => procs.run(cmd, cwd, t, sig),
  secrets: () => vault.allValues(),
  reasoning: async (project) => reasoning.resolve((await settings.get()).projectReasoning[project]),
  modelVision: async (m) => (await models.find(m))?.vision ?? false,
  web: { search: (q, max, sig) => webSearch(q, sig, max), fetch: (u, sig) => webFetch(u, sig) },
  analyzeImage: imaging.analyzeImage,
  readAttachments: imaging.readAttachments,
  imageLimit: imaging.imageLimit,
  readPdf: imaging.readPdf,
  environment: () => probeEnvironment(),
  browser: preview,
  skills: (p) => skills.load(p),
  spentToday: () => costs.spentToday(),
  hasModel: async (m) => !!(await models.find(m)),
  mcp: {
    toolsFor: (p, only, problems, waitMs) => mcp.toolsFor(p, only, problems, waitMs),
    connectors: (p) => mcp.connectors(p),
    ensure: (id, p) => mcp.ensure(id, p),
    call: (s, p, t, a) => mcp.call(s, p, t, a)
  }
})

// Chief of Staff tools read approvals and running tasks from the runner and keep their data in the app data folder
configureChief({ appDir: APP_DIR, approvals: () => runner.pendingApprovals(), activeRuns: () => runner.activeRuns(), startTask: (req) => runner.start(req) })
