import { updateSettings, useStore } from '../store'
import { switchChat } from '../chats'
import { chatKind, countNeeds, projectKind, STATUS_LABEL } from '../status'
import { StatusIcon } from './StatusIcon'

/** The open project's tab marker: the highest-priority state of all its chats. */
export function ProjectStatus({ root }: { root: string }) {
  const kind = useStore((s) => projectKind(s.projects[root]))
  return <StatusIcon kind={kind} size={13} hideIdle />
}

/** Go to the first chat, in any project, that is waiting for the user. */
function goToWaiting(): void {
  const st = useStore.getState()
  for (const [root, p] of Object.entries(st.projects)) {
    const t = p.chats.find((c) => chatKind(p, c.key) === 'needs')
    if (!t) continue
    st.set({ view: 'workspace' })
    if (st.settings?.activeProject !== root) void updateSettings({ activeProject: root })
    switchChat(root, t.key)
    return
  }
}

/** Status bar: the open project's state in words, and how many chats anywhere wait for you. */
export function StatusSummary({ root }: { root: string | null }) {
  const kind = useStore((s) => (root ? projectKind(s.projects[root]) : 'idle'))
  const waiting = useStore((s) => countNeeds(s.projects))
  const here = useStore((s) => (root && s.projects[root] ? s.projects[root].chats.filter((t) => chatKind(s.projects[root], t.key) === 'needs').length : 0))
  const set = useStore((s) => s.set)
  return (
    <>
      {kind !== 'idle' && (
        <button className={`sb-btn sb-item sb-status sb-${kind}`} onClick={() => (kind === 'needs' ? goToWaiting() : set({ view: 'workspace' }))} title={kind === 'needs' ? 'Go to the chat that needs you' : 'Show the chat'}>
          <StatusIcon kind={kind} size={12} /> {STATUS_LABEL[kind]}
        </button>
      )}
      {waiting > here && (
        <button className="sb-btn sb-item sb-status sb-needs" onClick={goToWaiting} title="A chat in another project needs your approval or answer">
          <StatusIcon kind="needs" size={12} /> {waiting - here} waiting in other projects
        </button>
      )}
    </>
  )
}
