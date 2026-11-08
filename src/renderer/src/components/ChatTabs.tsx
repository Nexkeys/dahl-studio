import { useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { useStore } from '../store'
import { closeChat, newChat, switchChat } from '../chats'
import { statusKind, statusText, waitsForAnswer } from '../status'
import { StatusIcon } from './StatusIcon'

const NONE: never[] = []

/** One tab per conversation. A chat keeps working in the background while another one is on screen. */
export function ChatTabs({ root }: { root: string }) {
  const chats = useStore((s) => s.projects[root]?.chats)
  const active = useStore((s) => s.projects[root]?.chat)
  const viewStatus = useStore((s) => s.projects[root]?.status ?? null)
  const viewRun = useStore((s) => s.projects[root]?.runId ?? null)
  const approvals = useStore((s) => s.projects[root]?.approvals ?? NONE)
  const activeUnread = useStore((s) => !!s.projects[root]?.chats.find((t) => t.key === s.projects[root]?.chat)?.unread)

  // the chat on screen is seen: clear its "done, not seen" dot (once the window is visible)
  useEffect(() => {
    if (!activeUnread) return
    const clear = () => document.visibilityState === 'visible' && useStore.getState().patchProject(root, (c) => ({ chats: c.chats.map((t) => (t.key === c.chat ? { ...t, unread: false } : t)) }))
    clear()
    document.addEventListener('visibilitychange', clear)
    return () => document.removeEventListener('visibilitychange', clear)
  }, [activeUnread, root])

  if (!chats) return null
  return (
    <div className="chat-tabs" role="tablist" aria-label="Chats" onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}>
      {chats.map((t) => {
        const on = t.key === active
        const status = on ? viewStatus : t.status
        const kind = statusKind(status, t.unread)
        const question = kind === 'needs' && waitsForAnswer(approvals, on ? viewRun : t.runId, t.snap?.transcript ?? NONE)
        return (
          <div key={t.key} role="tab" aria-selected={on} tabIndex={0} className={`chat-tab tab-${kind} ${on ? 'on' : ''}`} title={`${t.title} (${statusText(status, t.unread)})`}
            onClick={() => switchChat(root, t.key)}
            onKeyDown={(e) => e.key === 'Enter' && switchChat(root, t.key)}
            onAuxClick={(e) => e.button === 1 && closeChat(root, t.key)}>
            <StatusIcon kind={kind} question={question} size={13} />
            <span className="ellipsis">{t.title}</span>
            {chats.length > 1 || t.runId ? (
              <button className="tab-close" aria-label={`Close ${t.title}`} onClick={(e) => { e.stopPropagation(); closeChat(root, t.key) }}><X size={11} /></button>
            ) : null}
          </div>
        )
      })}
      <button className="icon-btn chat-tab-new" title="New chat" aria-label="New chat" onClick={() => newChat(root)}><Plus size={14} /></button>
    </div>
  )
}
