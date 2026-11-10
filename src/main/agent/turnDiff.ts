import fs from 'node:fs/promises'
import { countLineChanges, type FileChange } from '@shared/lineDiff'
import { readText, resolveInside } from '../fs/workspace'
import { ProjectStore } from '../store/projectStore'

/**
 * What the run's latest turn changed, per file, for the chat's "+N -M" pill. The baseline is the run's own backups
 * (each file as it was before the agent first changed it this turn, the same data Revert uses), so it works without
 * git and counts only Dahl's changes.
 */
export async function turnDiff(root: string, runId: string): Promise<FileChange[]> {
  if (!/^[\w-]+$/.test(runId)) return []
  const run = await new ProjectStore(root).loadRun(runId)
  if (!run) return []
  const out: FileChange[] = []
  for (const [path, before] of Object.entries(run.backups ?? {}).slice(0, 200)) {
    let after: string | null = null
    let skipped = false
    try {
      after = await readText(root, path)
    } catch {
      // deleted, too large or binary: still listed, without line counts
      skipped = await fs.stat(await resolveInside(root, path)).then(() => true, () => false)
    }
    const lines = skipped ? { added: 0, removed: 0 } : countLineChanges(before ?? '', after ?? '')
    if (!skipped && !lines.added && !lines.removed && before !== null) continue
    out.push({ path, ...lines, created: before === null, ...(skipped ? { skipped } : {}) })
  }
  return out
}
