import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { log, send } from './services'

/**
 * Auto-update from GitHub Releases (Nexkeys/dahl-studio, configured in electron-builder.yml "publish").
 * The app checks the public latest.yml on GitHub; no Dahl server, account or database is involved.
 * Downloads happen in the background; installation happens only when the user restarts.
 */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'dev'
  version?: string
  percent?: number
  error?: string
  current: string
}

let status: UpdateStatus = { state: 'idle', current: app.getVersion() }

function set(s: Partial<UpdateStatus>): void {
  status = { ...status, ...s, current: app.getVersion() }
  send('update:status', status)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function initUpdater(): void {
  if (!app.isPackaged || process.env.DAHL_SMOKE) {
    status = { state: 'dev', current: app.getVersion() }
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: (m: unknown) => void log('info', `updater: ${m}`), warn: (m: unknown) => void log('info', `updater: ${m}`), error: (m: unknown) => void log('error', `updater: ${m}`), debug: () => {} }
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => set({ state: 'error', error: String(e?.message ?? e).slice(0, 300) }))
  setTimeout(() => void checkForUpdates(), 15_000) // never delays startup
  setInterval(() => void checkForUpdates(), 4 * 60 * 60 * 1000)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === 'dev') return status
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ state: 'error', error: (e as Error).message.slice(0, 300) })
  }
  return status
}

export function installUpdate(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall(false, true)
}
