// Type-only import: erased at build time, so Monaco stays in its lazy chunk (this module is loaded by monaco.ts).
import type * as Monaco from 'monaco-editor'
import type { CompletionRequest, CompletionResponse } from '@shared/types'
import { composeInline, lineRest } from '@shared/completion'
import { api, useStore } from '../store'
import { languageFor } from '../lang'
import { setCompletionActivity } from './state'

// Tab completions: grey ghost text from a fast model, through Monaco's inline completions. Tab accepts all of it,
// Ctrl+Right the next word (Monaco defaults), Esc dismisses, Alt+\ asks again on demand.

/** context sent with a request; the main process trims it further to its prompt budget */
const LINES_BEFORE = 400
const LINES_AFTER = 150
const MAX_PREFIX = 12_000
const MAX_SUFFIX = 4_000
const RELATED_LINES = 30

function enabled(): boolean {
  const s = useStore.getState().settings
  return !!s?.tabCompletions && !!s.completionModel
}

/** The open tab an editor model belongs to, or null (diff review models, other widgets, a review in progress). */
function fileOf(model: Monaco.editor.ITextModel): { root: string; path: string } | null {
  const uri = model.uri
  // EditorArea names its models inmemory://p<project hash>/<relative path>
  if (uri.scheme !== 'inmemory' || !/^p[0-9a-z]+$/.test(uri.authority)) return null
  const st = useStore.getState()
  const root = st.settings?.activeProject
  const p = root ? st.projects[root] : undefined
  const path = uri.path.replace(/^\//, '')
  if (!root || !p || p.reviewing || !p.tabs.some((t) => t.path === path)) return null
  return { root, path }
}

/** The first lines of up to two other open tabs in the same language. */
function relatedTabs(root: string, path: string): CompletionRequest['related'] {
  const lang = languageFor(path)
  return useStore.getState().project(root).tabs
    .filter((t) => t.path !== path && languageFor(t.path) === lang)
    .slice(0, 2)
    .map((t) => ({ path: t.path, text: t.content.split('\n').slice(0, RELATED_LINES).join('\n') }))
}

let seq = 0

export function registerTabCompletions(monaco: typeof Monaco): Monaco.IDisposable {
  const LF = monaco.editor.EndOfLinePreference.LF
  const provider: Monaco.languages.InlineCompletionsProvider = {
    displayName: 'Dahl Tab completions',
    // overrides Monaco's 50 ms: one request per 250 ms pause in typing
    debounceDelayMs: 250,
    async provideInlineCompletions(model, position, context, token) {
      const none = { items: [] }
      // while the suggestion widget is open its list wins: no ghost text
      if (!enabled() || context.selectedSuggestionInfo) return none
      const file = fileOf(model)
      if (!file) return none
      const { lineNumber: line, column } = position
      const last = Math.min(model.getLineCount(), line + LINES_AFTER)
      const prefix = model.getValueInRange(new monaco.Range(Math.max(1, line - LINES_BEFORE), 1, line, column), LF).slice(-MAX_PREFIX)
      const suffix = model.getValueInRange(new monaco.Range(line, column, last, model.getLineMaxColumn(last)), LF).slice(0, MAX_SUFFIX)
      const id = ++seq
      const req: CompletionRequest = {
        id, path: file.path, language: model.getLanguageId(), prefix, suffix,
        related: relatedTabs(file.root, file.path),
        explicit: context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit
      }
      const sub = token.onCancellationRequested(() => void api.invoke('completion:cancel', id).catch(() => 0))
      setCompletionActivity('thinking')
      try {
        const r = await api.invoke<CompletionResponse>('completion:request', req)
        // a newer request owns the indicator
        if (id === seq) setCompletionActivity(r.error ? 'error' : 'idle', r.error ?? null)
        if (!r.text || token.isCancellationRequested) return none
        const { insertText, replaceRest } = composeInline(r.text, lineRest(suffix))
        const end = replaceRest ? model.getLineMaxColumn(line) : column
        // automatic triggers get one item; the main process returns one answer for explicit triggers too
        return { items: [{ insertText, range: new monaco.Range(line, column, line, end) }] }
      } catch (e) {
        if (id === seq) setCompletionActivity('error', (e as Error).message)
        return none
      } finally {
        sub.dispose()
      }
    },
    disposeInlineCompletions() {
      // items hold no resources
    }
  }
  // Alt+\ asks for a suggestion now (as in VS Code; Monaco ships the command without a key)
  monaco.editor.addKeybindingRule({ keybinding: monaco.KeyMod.Alt | monaco.KeyCode.Backslash, command: 'editor.action.inlineSuggest.trigger' })
  return monaco.languages.registerInlineCompletionsProvider('*', provider)
}
