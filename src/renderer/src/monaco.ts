// Load Monaco from the local package (never from a CDN) and wire its web workers through Vite.
// Only reached through lazyMonaco.ts, so the editor bundle is not parsed at startup.
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { THEMES } from './themes'
import { registerTabCompletions } from './completion/provider'

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
// Tab completions (grey ghost text); the provider asks nothing while the feature is off
registerTabCompletions(monaco)

export { monaco }
export { default as Editor, DiffEditor } from '@monaco-editor/react'
