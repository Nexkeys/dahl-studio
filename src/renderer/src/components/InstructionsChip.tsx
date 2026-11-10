import { useEffect, useState } from 'react'
import { ScrollText, ChevronRight } from 'lucide-react'
import type { InstructionFileInfo } from '@shared/types'
import { api, openFile, useStore } from '../store'
import '../ui-skills.css'

const KIND: Record<InstructionFileInfo['kind'], string> = {
  claude: 'CLAUDE.md', agents: 'AGENTS.md', 'cursor-rule': 'Cursor rule', cursorrules: '.cursorrules', copilot: 'Copilot', import: 'Imported'
}

/** "Instructions loaded" chip: which CLAUDE.md, AGENTS.md and Cursor/Copilot rule files Dahl read, and why. Rows open the file. */
export function InstructionsChip({ root, files, label = 'Instructions loaded' }: { root: string; files: InstructionFileInfo[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const loaded = files.filter((f) => !f.listed)
  const listed = files.length - loaded.length
  const names = loaded.map((f) => f.path.split('/').pop())
  return (
    <div className="ins-chip-wrap">
      <button className="chip ins-chip" onClick={() => setOpen(!open)} aria-expanded={open} title="Project instruction files Dahl follows in this chat">
        <ScrollText size={12} /> {label}: {names.length ? names.slice(0, 3).join(', ') : 'none'}{names.length > 3 ? ` +${names.length - 3}` : ''}
        {listed > 0 && <span className="muted">, {listed} on request</span>}
        <ChevronRight size={11} className={`chev ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="ins-list">
          {files.map((f) => (
            <button key={f.path} className={`ins-row ${f.listed ? 'listed' : ''}`} onClick={() => void openFile(root, f.path)} title={`Open ${f.path}`}>
              <span className="mono">{f.path}</span>
              <span className="muted">{KIND[f.kind]}: {f.listed ? 'read on request' : f.reason}{f.truncated ? ' (shortened)' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The project's always-on instruction files, shown above the composer so the user knows what Dahl will follow. */
export function ProjectInstructions({ root }: { root: string }) {
  const [files, setFiles] = useState<InstructionFileInfo[]>([])
  const status = useStore((s) => s.projects[root]?.status)
  useEffect(() => {
    let live = true
    api.invoke<InstructionFileInfo[]>('instructions:list', root).then((f) => live && setFiles(f), () => live && setFiles([]))
    return () => {
      live = false
    }
  }, [root, status])
  if (!files.length) return null
  return <div className="ins-project"><InstructionsChip root={root} files={files} label="Instructions" /></div>
}
