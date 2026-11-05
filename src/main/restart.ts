import { app } from 'electron'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import type { RunState } from '@shared/types'
import { log, runner } from './services'
import { getUpdateStatus, installUpdate, setInstallWaiting } from './updater'

// Work survives restarts. Before Dahl Studio closes with tasks running, each task is checkpointed and a resume note
// (userData/resume.json) records why. On the next start the tasks are marked interrupted as before, and the renderer
// either continues them on its own (restart for an update the user asked for) or offers to (quit or crash).

export interface ResumeRun { project: string; runId: string; objective: string; mode: RunState['mode']; model: string; thinking: RunState['thinking'] }
export interface ResumeOffer { reason: 'update' | 'quit' | 'crash'; runs: ResumeRun[] }

const file = (): string => path.join(app.getPath('userData'), 'resume.json')
let restartingForUpdate = false
let waitTimer: ReturnType<typeof setInterval> | null = null
let offer: ResumeOffer | null = null

/** Checkpoint running tasks and remember them for the next start. Returns how many there were. */
export async function saveForResume(reason: 'update' | 'quit'): Promise<number> {
  if (reason === 'quit' && restartingForUpdate) return 0 // the update restart already wrote its note
  const runs = runner.activeRuns()
  if (!runs.length) return 0
  await runner.checkpointAll()
  await fsp.writeFile(file(), JSON.stringify({ reason, at: new Date().toISOString(), runs })).catch(() => {})
  void log('info', `saved ${runs.length} running task(s) to resume after ${reason}`)
  return runs.length
}

/** Install the downloaded update now (tasks are saved and continue after the restart) or once no task is running. */
export async function installWhen(mode: 'now' | 'idle' | 'cancel'): Promise<void> {
  if (waitTimer) clearInterval(waitTimer)
  waitTimer = null
  setInstallWaiting(false)
  if (mode === 'cancel' || getUpdateStatus().state !== 'ready') return
  const go = async () => {
    await saveForResume('update')
    restartingForUpdate = true
    installUpdate()
  }
  if (mode === 'now' || !runner.activeRuns().length) return go()
  setInstallWaiting(true)
  waitTimer = setInterval(() => {
    if (runner.activeRuns().length) return
    clearInterval(waitTimer!)
    waitTimer = null
    void go()
  }, 2000)
}

/** At startup: turn the runs that were interrupted, plus the resume note, into one offer for the renderer. */
export async function buildResumeOffer(interrupted: RunState[]): Promise<void> {
  let note: { reason?: string; at?: string; runs?: { runId: string }[] } | null = null
  try {
    note = JSON.parse(await fsp.readFile(file(), 'utf8'))
  } catch {
    note = null
  }
  await fsp.unlink(file()).catch(() => {})
  if (!interrupted.length) return
  // an update restart takes a minute or two; an old note is not trusted to auto-resume
  const fresh = !!note?.at && Date.now() - Date.parse(note.at) < 2 * 60 * 60 * 1000
  const reason: ResumeOffer['reason'] = note?.reason === 'update' && fresh ? 'update' : note?.reason === 'quit' ? 'quit' : 'crash'
  offer = {
    reason,
    runs: interrupted.map((r) => ({ project: r.project, runId: r.id, objective: r.objective, mode: r.mode, model: r.model, thinking: r.thinking }))
  }
}

/** Handed to the renderer once. */
export function takeResumeOffer(): ResumeOffer | null {
  const o = offer
  offer = null
  return o
}
