// Load Monaco from the local package (never from a CDN) and wire its web workers through Vite.
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { THEMES } from './themes'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

for (const t of THEMES) monaco.editor.defineTheme(t.id, t.monaco)
loader.config({ monaco })

export { monaco }

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', md: 'markdown', py: 'python',
  rs: 'rust', go: 'go', java: 'java', cs: 'csharp', cpp: 'cpp', cc: 'cpp', c: 'c', h: 'cpp', hpp: 'cpp',
  rb: 'ruby', php: 'php', sh: 'shell', ps1: 'powershell', yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql',
  kt: 'kotlin', swift: 'swift', lua: 'lua', dart: 'dart', toml: 'ini', ini: 'ini', dockerfile: 'dockerfile', vue: 'html', svelte: 'html'
}

export function languageFor(file: string): string {
  const name = file.split('/').pop()!.toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  return EXT_LANG[name.split('.').pop() ?? ''] ?? 'plaintext'
}
