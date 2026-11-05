import type { AgentMode, StartRunRequest, ThinkingLevel } from '@shared/types'
import { api, useStore } from './store'
import { openRunInChat, restoreChats } from './chats'

// Continue tasks that a restart interrupted (see src/main/restart.ts). After an update the user asked for, they
// continue on their own; after a quit or a crash the user is asked first (ResumeCard).

export interface ResumeRun { project: string; runId: string; objective: string; mode: AgentMode; model: string; thinking: ThinkingLevel }
export interface ResumeOffer { reason: 'update' | 'quit' | 'crash'; runs: ResumeRun[] }

const PROMPT: Record<ResumeOffer['reason'], string> = {
  update: 'Continue where you stopped (Dahl Studio restarted to install an update).',
  quit: 'Continue where you stopped (Dahl Studio was closed during this task).',
  crash: 'Continue where you stopped (Dahl Studio closed unexpectedly during this task).'
}

/** Reopen each run in its chat tab and continue it. Returns how many started. */
export async function resumeRuns(offer: ResumeOffer): Promise<number> {
  const st = useStore.getState()
  const open = (st.settings?.openProjects ?? []).map((p) => p.toLowerCase())
  let n = 0
  for (const r of offer.runs) {
    if (!open.includes(r.project.toLowerCase())) continue
    try {
      // bring back the project's other chat tabs first, then put this run on screen with its history loaded
      restoreChats(r.project)
      await openRunInChat(r.project, r.runId)
      const req: StartRunRequest = { project: r.project, prompt: PROMPT[offer.reason], mode: r.mode, model: r.model, thinking: r.thinking, web: st.settings?.webResearch ?? true, attachments: [], resumeRunId: r.runId }
      await api.invoke('agent:start', req)
      n++
    } catch (e) {
      st.notify(`Could not continue "${r.objective.slice(0, 60)}": ${(e as Error).message}`, 'error')
    }
  }
  return n
}

/** At startup: continue after an update, or keep the offer for the ResumeCard. */
export async function handleResumeOffer(): Promise<void> {
  const offer = await api.invoke<ResumeOffer | null>('app:resume').catch(() => null)
  if (!offer?.runs.length) return
  const st = useStore.getState()
  if (offer.reason !== 'update') return st.set({ resumeOffer: offer })
  const n = await resumeRuns(offer)
  if (n) st.notify(`Updated. ${n === 1 ? 'Your task continues' : `${n} tasks continue`} from where ${n === 1 ? 'it' : 'they'} stopped.`)
}
