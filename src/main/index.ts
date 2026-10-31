import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
// services must be imported first: it sets the userData path before anything else touches it
import { log, mcp, models, procs, settings, win } from './services'
import { registerIpc } from './ipc'
import { initUpdater } from './updater'
import { ProjectStore } from './store/projectStore'
import { isAllowedPreviewRequest } from '@shared/preview'

if (!process.env.DAHL_SMOKE && !app.requestSingleInstanceLock()) app.quit()

process.on('uncaughtException', (e) => void log('error', `uncaughtException: ${e.stack ?? e.message}`))
process.on('unhandledRejection', (e) => void log('error', `unhandledRejection: ${String((e as Error)?.stack ?? e)}`))

function createWindow(): void {
  const w = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Dahl Studio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181b' : '#f7f5f1',
    icon: path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources'), 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, webviewTag: true }
  })
  win.current = w
  w.setMenuBarVisibility(false)
  w.once('ready-to-show', () => w.show())
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  hardenPreview(w)
  w.webContents.on('render-process-gone', (_e, d) => void log('error', `renderer gone: ${d.reason}`))
  const consoleErrors: string[] = []
  w.webContents.on('console-message', (e) => {
    const ev = e as unknown as { level: string | number; message: string }
    if (ev.level === 'error' || ev.level === 3) {
      consoleErrors.push(ev.message)
      void log('error', `renderer console: ${ev.message}`)
    }
  })

  // Smoke-test mode: load, optionally click/run JS, screenshot, report, exit.
  const smokeDir = process.env.DAHL_SMOKE
  if (smokeDir) {
    const t0 = Date.now()
    w.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.DAHL_SMOKE_JS) {
          try {
            await w.webContents.executeJavaScript(process.env.DAHL_SMOKE_JS, true)
          } catch (e) {
            consoleErrors.push(`SMOKE_JS: ${(e as Error).message}`)
          }
          await new Promise((r) => setTimeout(r, Number(process.env.DAHL_SMOKE_JS_WAIT ?? 2500)))
        }
        if (process.env.DAHL_SMOKE_CLICK) {
          await w.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(`[title="${process.env.DAHL_SMOKE_CLICK}"]`)})?.click()`)
          await new Promise((r) => setTimeout(r, 2500))
        }
        const probe = await w.webContents.executeJavaScript(`({ app: !!document.querySelector('.app'), welcome: !!document.querySelector('.welcome'), editor: !!document.querySelector('.monaco-editor'), text: document.body.innerText.slice(0, 600) })`)
        const img = await w.webContents.capturePage()
        await fs.mkdir(smokeDir, { recursive: true })
        await fs.writeFile(path.join(smokeDir, 'smoke.png'), img.toPNG())
        await fs.writeFile(path.join(smokeDir, 'smoke.json'), JSON.stringify({ loadMs: Date.now() - t0, probe, consoleErrors }, null, 2))
        app.quit()
      }, Number(process.env.DAHL_SMOKE_WAIT ?? 4000))
    })
  }

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void w.loadFile(path.join(__dirname, '../renderer/index.html'))
}

// Preview browser (<webview> in the renderer). Guests get no preload, no Node, a sandbox and their own session.
const PREVIEW_PARTITION = 'persist:dahl-preview'
const openWeb = (url: string): void => void (/^https?:\/\//.test(url) && shell.openExternal(url))

function hardenPreview(w: BrowserWindow): void {
  w.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    Object.assign(prefs, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, partition: PREVIEW_PARTITION })
    params.partition = PREVIEW_PARTITION
    if (!/^(https?|file):/i.test(params.src ?? '')) e.preventDefault()
  })
  w.webContents.on('did-attach-webview', (_e, guest) => {
    // popups open in the system browser (http/https only), never inside the app
    guest.setWindowOpenHandler(({ url }) => (openWeb(url), { action: 'deny' }))
    guest.on('will-navigate', (e) => {
      if (!/^(https?|file):/i.test(e.url)) e.preventDefault()
    })
  })
}

function setupPreviewSession(): void {
  const ses = session.fromPartition(PREVIEW_PARTITION)
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (e) => e.preventDefault())
  // every request a previewed page makes: web URLs pass, file: URLs only inside the active project
  ses.webRequest.onBeforeRequest((d, cb) => {
    if (!/^file:/i.test(d.url)) return cb({ cancel: !isAllowedPreviewRequest(d.url, null) })
    settings.get().then((s) => cb({ cancel: !isAllowedPreviewRequest(d.url, s.activeProject) }), () => cb({ cancel: true }))
  })
}

app.on('second-instance', () => {
  const w = win.current
  if (w) {
    if (w.isMinimized()) w.restore()
    w.focus()
  }
})

app.whenReady().then(async () => {
  // Only the installed app uses the real AppUserModelId. Dev/smoke runs use electron.exe (atom icon); sharing the
  // id made Windows cache the atom icon for the installed app's taskbar button.
  app.setAppUserModelId(app.isPackaged && !process.env.DAHL_SMOKE ? 'global.dahl.studio' : 'global.dahl.studio.dev')
  registerIpc()
  setupPreviewSession()
  for (const p of (await settings.get()).openProjects) await new ProjectStore(p).markInterrupted().catch(() => 0)
  createWindow()
  // Discover models in the background (never blocks the window), then keep the list fresh.
  void models.refresh().catch((e) => log('error', `model refresh: ${(e as Error).message}`))
  models.startAutoRefresh()
  initUpdater()
  void log('info', `started v${app.getVersion()}`)
})

app.on('window-all-closed', () => {
  procs.stopAll()
  mcp.stopAll()
  app.quit()
})
