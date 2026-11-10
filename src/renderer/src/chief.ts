import { useStore } from './store'
import { newChat } from './chats'

/** The Chief of Staff request (skills/chief-of-staff/SKILL.md describes the format; the chief_* tools do the work). */
export const CHIEF_PROMPT = 'Chief of Staff (skill: chief-of-staff): give me my briefing. Call chief_briefing, then answer in the chief-of-staff format: scannable in under 30 seconds, my priorities first, then what needs me, then what the agents did since the last briefing, then suggested next moves per project. If an email or calendar connector is available, add today\'s schedule and replies I owe; otherwise leave those out. Do not start anything without asking me.'

/** Command palette "Chief of Staff": a fresh chat tab with the briefing request ready to send (Plan mode, read-only). */
export function openChief(): void {
  const st = useStore.getState()
  const root = st.settings?.activeProject
  if (!root) return st.notify('Open a project first: the Chief of Staff works from a chat (it still covers every open project).', 'error')
  st.set({ view: 'workspace', mode: 'plan' })
  if (!newChat(root)) return
  st.set({ composerInsert: CHIEF_PROMPT })
}
