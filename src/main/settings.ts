import path from 'node:path'
import type { Settings } from '@shared/types'
import { readJson, writeJson } from './util'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dahl-classic',
  defaultModel: null,
  thinking: 'medium',
  preferredKey: 'primary',
  keyNames: { primary: 'Dahl primary', secondary: 'Dahl secondary', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', nvidia: 'NVIDIA' },
  autoApproveWrites: false,
  autoApproveCommands: false,
  autoApproveAll: false,
  askBeforePublishing: true,
  autoMemory: true,
  maintainProgress: true,
  notifications: true,
  effects: 'auto',
  webResearch: true,
  openProjects: [],
  activeProject: null,
  projectReasoning: {},
  lastSeenVersion: null
}

export class SettingsStore {
  private file: string
  private cache: Settings | null = null

  constructor(appDataDir: string) {
    this.file = path.join(appDataDir, 'settings.json')
  }

  async get(): Promise<Settings> {
    if (!this.cache) {
      const stored = await readJson<Partial<Settings>>(this.file, {})
      const s: Settings = { ...DEFAULT_SETTINGS, ...stored, keyNames: { ...DEFAULT_SETTINGS.keyNames, ...(stored.keyNames ?? {}) }, projectReasoning: stored.projectReasoning ?? {} }
      // migrate pre-0.3 model ids (no provider prefix) to the Dahl provider
      if (s.defaultModel && !s.defaultModel.includes(':')) s.defaultModel = `dahl:${s.defaultModel}`
      // settings saved by a version before What's New existed: that user upgraded, so show them what is new
      if (stored.lastSeenVersion === undefined && Object.keys(stored).length) s.lastSeenVersion = '0.0.0'
      this.cache = s
    }
    return this.cache
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const cur = await this.get()
    this.cache = { ...cur, ...patch }
    await writeJson(this.file, this.cache)
    return this.cache
  }
}
