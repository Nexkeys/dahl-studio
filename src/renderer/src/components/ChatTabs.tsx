import { Plus, X } from 'lucide-react'
import { useStore } from '../store'
import { closeChat, newChat, switchChat } from '../chats'

/** One tab per conversation. A chat keeps working in the background while another one is on screen. */
export function ChatTabs({ root }: { root: string }) {
  const chats = useStore((s) => s.projects[root]?.chats)
  const active = useStore((s) => s.projects[root]?.chat)
  const viewStatus = useStore((s) => s.projects[root]?.status ?? null)
  if (!chats) return null
  return (
    <div className="chat-tabs" role="tablist" aria-label="Chats" onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}>
      {chats.map((t) => {
        const on = t.key === active
        const status = on ? viewStatus : t.status
        return (
          <div key={t.key} role="tab" aria-selected={on} tabIndex={0} className={`chat-tab ${on ? 'on' : ''}`} title={t.title}
            onClick={() => switchChat(root, t.key)}
            onKeyDown={(e) => e.key === 'Enter' && switchChat(root, t.key)}
            onAuxClick={(e) => e.button === 1 && closeChat(root, t.key)}>
            <span className={`pdot ${status ?? 'idle'}`} />
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
