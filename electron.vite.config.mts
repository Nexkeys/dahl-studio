import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Content Security Policy for the packaged renderer: only the app's own files run or load. This also stops
// Markdown images in model replies from fetching remote URLs. Build only, because the dev server injects an
// inline React Fast Refresh script.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ')

const csp: Plugin = {
  name: 'dahl-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
}

// Ownership notice stamped into every built bundle and the renderer page (kept by minifiers as a /*! */ comment)
const NOTICE = 'Dahl Studio. Copyright (c) 2026 NexKeys. All rights reserved. Proprietary; see LICENSE.'
const stamp: Plugin = {
  name: 'dahl-stamp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>
    <meta name="copyright" content="${NOTICE}" />`),
  generateBundle(_o, bundle) {
    for (const c of Object.values(bundle)) if (c.type === 'chunk' && !c.code.startsWith('/*!')) c.code = `/*! ${NOTICE} */
${c.code}`
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [stamp]
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [stamp]
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), csp, stamp],
    build: { chunkSizeWarningLimit: 6000 }
  }
})
