// Renders the OCR evaluation pages to PNG with Electron (Chromium), at normal size, small (zoom 0.75) and dark mode.
// Usage: node_modules\electron\dist\electron.exe scripts\ocr-eval\render.cjs <outDir>
// Writes <name>-<variant>.png and <name>.txt (ground truth: the page's visible text). make-variants.cjs adds the
// blurry/downscaled variants afterwards.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const pages = require('./pages.cjs')

const out = path.resolve(process.argv[process.argv.length - 1])
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true })
  const win = new BrowserWindow({ width: 1000, height: 640, show: false, webPreferences: { offscreen: true } })
  for (const [name, html] of Object.entries(pages)) {
    for (const variant of ['normal', 'small', 'dark']) {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      win.webContents.setZoomFactor(variant === 'small' ? 0.75 : 1)
      if (variant === 'dark') await win.webContents.executeJavaScript("document.documentElement.classList.add('dark')")
      await new Promise((r) => setTimeout(r, 400))
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(out, `${name}-${variant}.png`), img.toPNG())
      if (variant === 'normal') fs.writeFileSync(path.join(out, `${name}.txt`), await win.webContents.executeJavaScript('document.body.innerText'))
    }
  }
  console.log('rendered', Object.keys(pages).length * 3, 'screenshots into', out)
  app.quit()
})
