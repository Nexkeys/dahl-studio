import { useEffect, useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, FilePlus, FolderPlus, RefreshCw } from 'lucide-react'
import type { TreeNode } from '@shared/types'
import { api, baseName, openFile, useStore } from '../store'

function Node({ root, node, depth, version }: { root: string; node: TreeNode; depth: number; version: number }) {
  const [open, setOpen] = useState(false)
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
      <button className={`tree-row ${active === node.path ? 'active' : ''}`} style={pad} onClick={() => openFile(root, node.path)} title={node.path}>
        <span className="tree-chev" />
        <FileText size={14} className="tree-icon" />
        <span className="tree-name">{node.name}</span>
      </button>
    )
  return (
    <>
      <button className="tree-row" style={pad} onClick={() => setOpen(!open)} aria-expanded={open} title={node.path}>
        <span className="tree-chev">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
        {open ? <FolderOpen size={14} className="tree-icon folder" /> : <Folder size={14} className="tree-icon folder" />}
        <span className="tree-name">{node.name}</span>
      </button>
      {open && kids?.map((k) => <Node key={k.path} root={root} node={k} depth={depth + 1} version={version} />)}
    </>
  )
}

export function Explorer({ root }: { root: string }) {
  const version = useStore((s) => s.projects[root]?.treeVersion ?? 0)
  const [nodes, setNodes] = useState<TreeNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [local, setLocal] = useState(0)

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

  const create = async (dir: boolean) => {
    const name = window.prompt(dir ? 'New folder (relative path)' : 'New file (relative path)')
    if (!name) return
    try {
      await api.invoke('fs:create', root, name, dir)
      setLocal((v) => v + 1)
      if (!dir) await openFile(root, name.replace(/\\/g, '/'))
    } catch (e) {
      useStore.getState().notify((e as Error).message, 'error')
    }
  }

  return (
    <div className="panel explorer">
      <div className="panel-head">
        <span className="panel-title" title={root}>{baseName(root)}</span>
        <div className="row-actions">
          <button className="icon-btn" title="New file" aria-label="New file" onClick={() => create(false)}><FilePlus size={15} /></button>
          <button className="icon-btn" title="New folder" aria-label="New folder" onClick={() => create(true)}><FolderPlus size={15} /></button>
          <button className="icon-btn" title="Refresh" aria-label="Refresh" onClick={() => setLocal((v) => v + 1)}><RefreshCw size={14} /></button>
        </div>
      </div>
      <div className="tree" role="tree">
        {error && <div className="empty error-text">{error}</div>}
        {!error && !nodes && <div className="empty">Loading files</div>}
        {nodes && nodes.length === 0 && <div className="empty">This folder is empty.</div>}
        {nodes?.map((n) => <Node key={n.path} root={root} node={n} depth={0} version={version + local} />)}
      </div>
    </div>
  )
}
