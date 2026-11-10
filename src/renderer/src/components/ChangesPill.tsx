import { useEffect, useRef, useState } from 'react'
import { FileDiff, FilePlus2, GitBranch, FolderOpen } from 'lucide-react'
import type { TranscriptItem } from '@shared/types'
import { totalChanges, type FileChange } from '@shared/lineDiff'
import { api, openFile, useStore } from '../store'

const WRITE_TOOLS = /^(write_file|edit_file|append_file)$/

/** Successful file writes in the chat so far (a cheap number to select; the pill refreshes when it changes). */
function writeCount(items: TranscriptItem[] | undefined): number {
  let n = 0
  for (const i of items ?? []) if (i.kind === 'tool' && i.tool?.ok && WRITE_TOOLS.test(i.tool.name)) n++
  return n
}

/** Files written in the latest turn, from the transcript (used when line counts are not available). */
function turnFiles(items: TranscriptItem[]): FileChange[] {
  const from = items.map((i) => i.kind).lastIndexOf('user') + 1
  const paths = new Set<string>()
  for (const i of items.slice(from))
    if (i.kind === 'tool' && i.tool?.ok && WRITE_TOOLS.test(i.tool.name))
      try {
        paths.add(String(JSON.parse(i.tool.args).path))
      } catch {
        /* arguments cut at 2000 characters */
      }
  return [...paths].map((path) => ({ path, added: 0, removed: 0, created: false, skipped: true }))
}

/**
 * "+N -M" for the chat's latest turn: lines Dahl added and removed, counted against each file as it was before the
 * turn. Opens a list of the changed files; each opens in the editor.
 */
export function ChangesPill({ root }: { root: string }) {
  const runId = useStore((s) => s.projects[root]?.runId ?? null)
  const writes = useStore((s) => writeCount(s.projects[root]?.transcript))
  const status = useStore((s) => s.projects[root]?.status ?? null)
  const [files, setFiles] = useState<FileChange[]>([])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!runId) return setFiles([])
    let live = true
    const t = setTimeout(() => {
      api.invoke<FileChange[]>('agent:turnDiff', root, runId)
        .then((f) => live && setFiles(f.length ? f : turnFiles(useStore.getState().project(root).transcript)))
        .catch(() => live && setFiles(turnFiles(useStore.getState().project(root).transcript)))
    }, 300)
    return () => ((live = false), clearTimeout(t))
  }, [root, runId, writes, status])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => (document.removeEventListener('mousedown', close), document.removeEventListener('keydown', esc))
  }, [open])

  if (!files.length) return null
  const t = totalChanges(files)
  const label = t.counted ? `${t.added} lines added, ${t.removed} removed in ${files.length} file${files.length > 1 ? 's' : ''}` : `${files.length} file${files.length > 1 ? 's' : ''} changed`
  return (
    <span className="changes-wrap" ref={box}>
      <button className="changes-pill" onClick={() => setOpen(!open)} aria-expanded={open} title={`${label} this turn. Show the files.`} aria-label={label}>
        <FileDiff size={12} />
        {t.counted ? <><b className="add">+{t.added}</b><b className="del">-{t.removed}</b></> : <span>{files.length} file{files.length > 1 ? 's' : ''}</span>}
      </button>
      {open && (
        <div className="changes-pop" role="dialog" aria-label="Changed files">
          <div className="changes-head">Changed this turn<span className="muted">{label}</span></div>
          <div className="changes-list">
            {files.map((f) => (
              <button key={f.path} className="changes-row" title={`Open ${f.path}`} onClick={() => (setOpen(false), void openFile(root, f.path))}>
                {f.created ? <FilePlus2 size={13} /> : <FileDiff size={13} />}
                <span className="changes-path">{f.path}</span>
                {!f.skipped && <span className="changes-n"><b className="add">+{f.added}</b> <b className="del">-{f.removed}</b></span>}
              </button>
            ))}
          </div>
          <div className="changes-foot">
            <button className="btn tiny ghost" onClick={() => (setOpen(false), files.forEach((f) => void openFile(root, f.path)))}><FolderOpen size={12} /> Open all</button>
            <button className="btn tiny ghost" onClick={() => (setOpen(false), useStore.getState().set({ view: 'git' }))}><GitBranch size={12} /> Source control</button>
          </div>
        </div>
      )}
    </span>
  )
}
