import { useEffect, useCallback } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { X, Check, Save, GitCompare, Code2 } from 'lucide-react'
import { addAttachments, api, useStore } from '../store'
import { languageFor } from '../monaco'

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function EditorArea({ root }: { root: string }) {
  const p = useStore((s) => s.projects[root])
  const theme = useStore((s) => s.settings?.theme ?? 'dahl-classic')
  const patch = useStore((s) => s.patchProject)
  const tabs = p?.tabs ?? []
  const active = tabs.find((t) => t.path === p?.active) ?? null
  const review = p?.approvals.find((a) => a.id === p?.reviewing && a.kind === 'write') ?? null

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const close = (path: string) => {
    const t = tabs.find((x) => x.path === path)
    if (t && t.content !== t.saved && !window.confirm(`${path} has unsaved changes. Close anyway?`)) return
    patch(root, (c) => {
      const rest = c.tabs.filter((x) => x.path !== path)
      return { tabs: rest, active: c.active === path ? rest[rest.length - 1]?.path ?? null : c.active }
    })
  }

  const decide = async (approved: boolean) => {
    if (!review) return
    const feedback = approved ? undefined : window.prompt('Optional: tell Dahl why, or what to do instead') ?? undefined
    await api.invoke('agent:approve', review.id, approved, feedback)
    patch(root, (c) => ({ approvals: c.approvals.filter((a) => a.id !== review.id), reviewing: null }))
  }

  return (
    <div className="panel editor-area">
      <div className="tabs" role="tablist">
        {review && (
          <div className="tab active review-tab" role="tab">
            <GitCompare size={13} />
            <span>Review: {review.path}</span>
          </div>
        )}
        {tabs.map((t) => (
          <div key={t.path} role="tab" aria-selected={!review && t.path === p?.active} className={`tab ${!review && t.path === p?.active ? 'active' : ''}`}
            onClick={() => patch(root, { active: t.path, reviewing: null })} title={t.path}>
            <span>{t.path.split('/').pop()}</span>
            {t.content !== t.saved && <span className="dirty" aria-label="unsaved" />}
            <button className="tab-close" aria-label={`Close ${t.path}`} onClick={(e) => { e.stopPropagation(); close(t.path) }}><X size={12} /></button>
          </div>
        ))}
        <div className="tabs-spacer" />
        {!review && active && active.content !== active.saved && (
          <button className="btn small ghost" onClick={save} title="Save (Ctrl+S)"><Save size={13} /> Save</button>
        )}
      </div>

      {review ? (
        <div className="review">
          <div className="review-bar">
            <div>
              <div className="review-title">{review.before ? 'Modify' : 'Create'} <code>{review.path}</code></div>
              {review.reason && <div className="muted small">{review.reason}</div>}
            </div>
            <div className="row-actions">
              <button className="btn ghost" onClick={() => decide(false)}><X size={14} /> Reject</button>
              <button className="btn primary" onClick={() => decide(true)}><Check size={14} /> Approve and apply</button>
            </div>
          </div>
          <div className="editor-host">
            <DiffEditor
              original={review.before ?? ''}
              modified={review.after ?? ''}
              language={languageFor(review.path ?? '')}
              theme={theme}
              options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 13, fontFamily: 'Cascadia Code, Consolas, monospace', automaticLayout: true }}
            />
          </div>
        </div>
      ) : active ? (
        <div className="editor-host">
          <Editor
            path={`inmemory://p${hash(root)}/${active.path}`}
            value={active.content}
            language={languageFor(active.path)}
            theme={theme}
            onChange={(v) => patch(root, (c) => ({ tabs: c.tabs.map((t) => (t.path === active.path ? { ...t, content: v ?? '' } : t)) }))}
            onMount={(ed, monaco) => {
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
