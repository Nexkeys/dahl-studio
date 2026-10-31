import { createContext, useContext, useEffect, useState, useCallback, type MouseEvent } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, FilePlus, FolderPlus, RefreshCw } from 'lucide-react'
import type { TreeNode } from '@shared/types'
import { api, baseName, openFile, useStore } from '../store'

interface Draft { parent: string; dir: boolean }
interface Ctx {
  root: string
  version: number
  expanded: Set<string>
  toggle: (p: string) => void
  sel: { path: string; dir: boolean } | null
  select: (path: string, dir: boolean) => void
  draft: Draft | null
  startDraft: (parent: string, dir: boolean) => void
  cancelDraft: (only?: Draft) => void
  submit: (name: string) => Promise<boolean>
}
const ExplorerCtx = createContext<Ctx>(null as unknown as Ctx)

const parentOf = (p: string): string => p.split('/').slice(0, -1).join('/')
const join = (a: string, b: string): string => (a ? `${a}/${b}` : b)
/** Every folder from the top down to `p` itself, so a nested target can be expanded in one go. */
const chain = (p: string): string[] => p.split('/').filter(Boolean).map((_, i, a) => a.slice(0, i + 1).join('/'))

/** Inline validation for a typed name. Nested paths like `src/components/new` are allowed. */
function validateName(raw: string, siblings: string[]): string | null {
  const name = raw.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!name) return 'A file or folder name must be provided.'
  if (name.startsWith('/')) return 'Use a path relative to the folder.'
  if (/[<>:"|?*]/.test(name)) return 'Names cannot contain any of these characters: < > : " | ? *'
  const parts = name.split('/')
  if (parts.some((s) => s === '..' || s === '.')) return 'Names cannot contain ".." or "." segments.'
  if (parts.some((s) => !s)) return 'Names cannot contain empty path segments.'
  if (parts.some((s) => /[. ]$/.test(s))) return 'Names cannot end with a space or a dot.'
  if (parts.length === 1 && siblings.some((s) => s.toLowerCase() === name.toLowerCase())) return `"${name}" already exists here. Choose a different name.`
  return null
}

function DraftRow({ depth, siblings }: { depth: number; siblings: string[] }) {
  const { draft, cancelDraft, submit } = useContext(ExplorerCtx)
  const [value, setValue] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!draft) return null
  const msg = value.trim() || tried ? validateName(value, siblings) : null
  const go = async () => {
    setTried(true)
    if (busy || validateName(value, siblings)) return
    setBusy(true)
    const ok = await submit(value.trim().replace(/\\/g, '/').replace(/\/+$/, ''))
    if (!ok) setBusy(false)
  }
  const label = draft.dir ? 'New folder name' : 'New file name'
  return (
    <div className="tree-draft" style={{ paddingLeft: 8 + depth * 14 }}>
      <div className="tree-draft-row">
        <span className="tree-chev" />
        {draft.dir ? <Folder size={14} className="tree-icon folder" /> : <FileText size={14} className="tree-icon" />}
        <input
          className={`tree-input ${msg ? 'invalid' : ''}`}
          autoFocus
          spellCheck={false}
          value={value}
          readOnly={busy}
          aria-label={label}
          aria-invalid={!!msg}
          aria-describedby={msg ? 'tree-draft-msg' : undefined}
          placeholder={draft.dir ? 'folder or path/to/folder' : 'file or path/to/file'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void go() }
            else if (e.key === 'Escape') { e.preventDefault(); cancelDraft() }
          }}
          // Only cancel this row's own draft (a row removed while focused also blurs), and not when the whole window loses focus.
          onBlur={() => { if (!busy && document.hasFocus()) cancelDraft(draft) }}
        />
      </div>
      {msg && <div id="tree-draft-msg" className="tree-msg" role="alert">{msg}</div>}
    </div>
  )
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const { root, version, expanded, toggle, sel, select, draft, startDraft } = useContext(ExplorerCtx)
  const open = node.dir && expanded.has(node.path)
  const [kids, setKids] = useState<TreeNode[] | null>(null)
  const active = useStore((s) => s.projects[root]?.active)

  const load = useCallback(async () => {
    try {
      setKids(await api.invoke<TreeNode[]>('fs:tree', root, node.path))
    } catch (e) {
      useStore.getState().notify((e as Error).message, 'error')
    }
  }, [root, node.path])

  useEffect(() => {
    if (open) void load()
  }, [open, version, load])

  const pad = { paddingLeft: 8 + depth * 14 }
  if (!node.dir)
    return (
      <button className={`tree-row ${active === node.path ? 'active' : ''}`} style={pad} onClick={() => { select(node.path, false); void openFile(root, node.path) }} title={node.path}>
        <span className="tree-chev" />
        <FileText size={14} className="tree-icon" />
        <span className="tree-name">{node.name}</span>
      </button>
    )
  const add = (dir: boolean) => (e: MouseEvent) => { e.stopPropagation(); startDraft(node.path, dir) }
  return (
    <>
      <div className="tree-item">
        <button
          className={`tree-row ${sel?.dir && sel.path === node.path ? 'selected' : ''}`}
          style={pad}
          onClick={() => { select(node.path, true); toggle(node.path) }}
          aria-expanded={open}
          title={node.path}
        >
          <span className="tree-chev">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
          {open ? <FolderOpen size={14} className="tree-icon folder" /> : <Folder size={14} className="tree-icon folder" />}
          <span className="tree-name">{node.name}</span>
        </button>
        <div className="tree-actions">
          <button className="tree-act" title="New file here" aria-label={`New file in ${node.name}`} onMouseDown={(e) => e.preventDefault()} onClick={add(false)}><FilePlus size={13} /></button>
          <button className="tree-act" title="New folder here" aria-label={`New folder in ${node.name}`} onMouseDown={(e) => e.preventDefault()} onClick={add(true)}><FolderPlus size={13} /></button>
        </div>
      </div>
      {open && draft?.parent === node.path && <DraftRow key={String(draft.dir)} depth={depth + 1} siblings={kids?.map((k) => k.name) ?? []} />}
      {open && kids?.map((k) => <Node key={k.path} node={k} depth={depth + 1} />)}
    </>
  )
}

export function Explorer({ root }: { root: string }) {
  const version = useStore((s) => s.projects[root]?.treeVersion ?? 0)
  const [nodes, setNodes] = useState<TreeNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [local, setLocal] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [sel, setSel] = useState<{ path: string; dir: boolean } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    setNodes(null)
    api
      .invoke<TreeNode[]>('fs:tree', root, '')
      .then((n) => {
        setNodes(n)
        setError(null)
      })
      .catch((e) => setError((e as Error).message))
  }, [root, version, local])

  const expand = (p: string) => setExpanded((s) => new Set([...s, ...chain(p)]))
  const toggle = (p: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (!n.delete(p)) n.add(p)
      return n
    })
  // VS Code style target: the selected folder, else the selected file's folder, else the project root.
  const target = sel ? (sel.dir ? sel.path : parentOf(sel.path)) : ''
  const startDraft = (parent: string, dir: boolean) => {
    if (parent) expand(parent)
    setDraft({ parent, dir })
  }
  const submit = async (name: string): Promise<boolean> => {
    if (!draft) return false
    const rel = join(draft.parent, name)
    try {
      await api.invoke('fs:create', root, rel, draft.dir)
    } catch (e) {
      useStore.getState().notify((e as Error).message, 'error')
      return false
    }
    setDraft(null)
    setLocal((v) => v + 1)
    if (draft.dir) {
      expand(rel)
      setSel({ path: rel, dir: true })
    } else {
      if (parentOf(rel)) expand(parentOf(rel))
      setSel({ path: rel, dir: false })
      await openFile(root, rel)
    }
    return true
  }

  const ctx: Ctx = { root, version: version + local, expanded, toggle, sel, select: (path, dir) => setSel({ path, dir }), draft, startDraft, cancelDraft: (only) => setDraft((d) => (!only || d === only ? null : d)), submit }
  return (
    <ExplorerCtx.Provider value={ctx}>
      <div className="panel explorer">
        <div className="panel-head">
          <span className="panel-title" title={root}>{baseName(root)}</span>
          <div className="row-actions">
            <button className="icon-btn" title={target ? `New file in ${target}` : 'New file'} aria-label="New file" onMouseDown={(e) => e.preventDefault()} onClick={() => startDraft(target, false)}><FilePlus size={15} /></button>
            <button className="icon-btn" title={target ? `New folder in ${target}` : 'New folder'} aria-label="New folder" onMouseDown={(e) => e.preventDefault()} onClick={() => startDraft(target, true)}><FolderPlus size={15} /></button>
            <button className="icon-btn" title="Refresh" aria-label="Refresh" onClick={() => setLocal((v) => v + 1)}><RefreshCw size={14} /></button>
          </div>
        </div>
        <div className="tree" role="tree" onClick={(e) => { if (e.target === e.currentTarget) setSel(null) }}>
          {error && <div className="empty error-text">{error}</div>}
          {!error && !nodes && <div className="empty">Loading files</div>}
          {draft?.parent === '' && <DraftRow key={String(draft.dir)} depth={0} siblings={nodes?.map((n) => n.name) ?? []} />}
          {nodes && nodes.length === 0 && !draft && <div className="empty">This folder is empty.</div>}
          {nodes?.map((n) => <Node key={n.path} node={n} depth={0} />)}
        </div>
      </div>
    </ExplorerCtx.Provider>
  )
}
