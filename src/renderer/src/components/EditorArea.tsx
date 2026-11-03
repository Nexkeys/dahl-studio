import { useEffect, useCallback, Suspense } from 'react'
import { Check, Save, Code2 } from 'lucide-react'
import { addAttachments, api, openFile, useStore } from '../store'
import { languageFor } from '../lang'
import { RejectButton } from './ApprovalCard'
import { Editor, DiffEditor } from '../lazyMonaco'
import { closeTabs, cycleTab, EditorCrumbs, EditorTabs, emitCursor, popClosedTab } from './EditorTabs'

const EditorLoading = () => <div className="empty-state"><span className="spinner" /></div>

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function EditorArea({ root }: { root: string }) {
  // narrow selectors: subscribing to the whole project would re-render the editor for every streamed reply update
  const tabs = useStore((s) => s.projects[root]?.tabs) ?? []
  const activePath = useStore((s) => s.projects[root]?.active ?? null)
  const review = useStore((s) => {
    const p = s.projects[root]
    return p?.approvals.find((a) => a.id === p.reviewing && a.kind === 'write') ?? null
  })
  const theme = useStore((s) => s.settings?.theme ?? 'dahl-classic')
  const patch = useStore((s) => s.patchProject)
  const active = tabs.find((t) => t.path === activePath) ?? null

  const save = useCallback(async () => {
    const st = useStore.getState()
    const cur = st.project(root)
    const tab = cur.tabs.find((t) => t.path === cur.active)
    if (!tab || tab.content === tab.saved) return
    try {
      await api.invoke('fs:write', root, tab.path, tab.content)
      st.patchProject(root, (c) => ({ tabs: c.tabs.map((t) => (t.path === tab.path ? { ...t, saved: tab.content } : t)) }))
      st.notify(`Saved ${tab.path}`)
    } catch (e) {
      st.notify((e as Error).message, 'error')
    }
  }, [root])

  // capture phase, so these win over Monaco's own bindings while the editor has focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      const hit = (fn: () => void) => (e.preventDefault(), e.stopPropagation(), fn())
      if (k === 's' && !e.shiftKey) return hit(() => void save())
      // Ctrl+W must never reach the window menu (it would close the app)
      if (k === 'w' && !e.shiftKey) return hit(() => { const a = useStore.getState().project(root).active; if (a) closeTabs(root, [a]) })
      if (k === 'tab') return hit(() => cycleTab(root, e.shiftKey ? -1 : 1))
      if (k === 't' && e.shiftKey) return hit(() => { const p = popClosedTab(root); if (p) void openFile(root, p) })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save, root])

  const decide = async (approved: boolean, feedback?: string) => {
    if (!review) return
    await api.invoke('agent:approve', review.id, approved, feedback)
    patch(root, (c) => ({ approvals: c.approvals.filter((a) => a.id !== review.id), reviewing: null }))
  }

  return (
    <div className="panel editor-area">
      <EditorTabs root={root} reviewPath={review?.path ?? null} saveButton={!review && active && active.content !== active.saved
        ? <button className="btn small ghost" onClick={save} title="Save (Ctrl+S)"><Save size={13} /> Save</button> : null} />
      {!review && active && <EditorCrumbs key={active.path} path={active.path} />}

      {review ? (
        <div className="review">
          <div className="review-bar">
            <div>
              <div className="review-title">{review.before ? 'Modify' : 'Create'} <code>{review.path}</code></div>
              {review.reason && <div className="muted small">{review.reason}</div>}
            </div>
            <div className="row-actions">
              <RejectButton className="btn ghost" onReject={(f) => void decide(false, f)} />
              <button className="btn primary" onClick={() => decide(true)}><Check size={14} /> Approve and apply</button>
            </div>
          </div>
          <div className="editor-host">
            <Suspense fallback={<EditorLoading />}>
              <DiffEditor keepCurrentOriginalModel keepCurrentModifiedModel
                original={review.before ?? ''}
                modified={review.after ?? ''}
                language={languageFor(review.path ?? '')}
                theme={theme}
                options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 13, fontFamily: 'Cascadia Code, Consolas, monospace', automaticLayout: true }}
              />
            </Suspense>
          </div>
        </div>
      ) : active ? (
        <div className="editor-host">
          <Suspense fallback={<EditorLoading />}>
            <Editor
              path={`inmemory://p${hash(root)}/${active.path}`}
              value={active.content}
              language={languageFor(active.path)}
              theme={theme}
              onChange={(v) => patch(root, (c) => ({ tabs: c.tabs.map((t) => (t.path === active.path ? { ...t, content: v ?? '' } : t)) }))}
              onMount={(ed, monaco) => {
                ed.onDidChangeCursorSelection((e) => {
                  const sel = e.selection
                  const model = ed.getModel()
                  emitCursor({ line: sel.positionLineNumber, col: sel.positionColumn, sel: model && !sel.isEmpty() ? model.getValueInRange(sel).length : 0 })
                })
                // Ctrl+L: send the selection (or current line) to the chat as an attachment
                ed.addAction({
                  id: 'dahl.askSelection',
                  label: 'Ask Dahl about selection',
                  keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
                  contextMenuGroupId: 'navigation',
                  run: (e) => {
                    const sel = e.getSelection()
                    const model = e.getModel()
                    if (!sel || !model) return
                    const text = sel.isEmpty() ? model.getLineContent(sel.startLineNumber) : model.getValueInRange(sel)
                    addAttachments(root, [{ id: crypto.randomUUID(), kind: 'selection', name: `${active.path}:${sel.startLineNumber}-${sel.endLineNumber}`, text }])
                    useStore.getState().notify('Selection attached to the chat')
                  }
                })
              }}
              options={{ fontSize: 13, fontFamily: 'Cascadia Code, Consolas, monospace', minimap: { enabled: true, scale: 1 }, smoothScrolling: true, automaticLayout: true, tabSize: 2, renderWhitespace: 'selection', bracketPairColorization: { enabled: true } }}
            />
          </Suspense>
        </div>
      ) : (
        <div className="empty-state">
          <Code2 size={28} strokeWidth={1.4} />
          <div className="empty-title">No file open</div>
          <div className="muted">Pick a file in the explorer, or ask Dahl to make a change. Proposed edits open here as a side-by-side diff for approval.</div>
        </div>
      )}
    </div>
  )
}
