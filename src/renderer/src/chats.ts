import type { RunState } from '@shared/types'
import { api, flushDeltas, useStore } from './store'
import { blankSnap, isBusy, MAX_CHATS, NEW_CHAT, newTab, pickSnap, titleFrom, type ChatSnap, type ChatTab } from './chatState'

// Chat tab actions. Open tabs (key, title, run id) are kept per project in localStorage, so they come back after a
// restart; the conversations themselves are the run checkpoints in <project>/.dahl/runs.

const storageKey = (root: string): string => `dahl.chats:${root}`
const restored = new Set<string>()

function persist(root: string): void {
  const p = useStore.getState().projects[root]
  if (!p) return
  const tabs = p.chats.map((t) => ({ key: t.key, title: t.title, runId: t.key === p.chat ? p.runId : t.runId }))
  try {
    localStorage.setItem(storageKey(root), JSON.stringify({ active: p.chat, tabs }))
  } catch {
    /* storage full or unavailable: tabs just are not remembered */
  }
}

/** Bring back the chat tabs from the last session, once per project, unless chats were already used this session. */
export function restoreChats(root: string): void {
  const st = useStore.getState()
  if (restored.has(root)) return
  restored.add(root)
  const p = st.projects[root]
  if (p && (p.chats.length > 1 || p.runId || p.transcript.length)) return
  let saved: { active?: string; tabs?: { key?: string; title?: string; runId?: string | null }[] } | null = null
  try {
    saved = JSON.parse(localStorage.getItem(storageKey(root)) ?? 'null')
  } catch {
    saved = null
  }
  if (!saved?.tabs?.length) return st.patchProject(root, {})
  const tabs: ChatTab[] = saved.tabs.slice(0, MAX_CHATS).map((t) => ({ key: String(t.key), title: String(t.title || NEW_CHAT), runId: t.runId ?? null, status: null, snap: null }))
  const active = tabs.find((t) => t.key === saved!.active) ?? tabs[0]
  st.patchProject(root, { ...blankSnap(), runId: active.runId, chats: tabs, chat: active.key, startingChat: null })
  if (active.runId) void fillFromRun(root, active.key, active.runId)
}

/** Load a saved run into a chat tab (the view if that tab is active, its snapshot otherwise). */
async function fillFromRun(root: string, key: string, runId: string): Promise<void> {
  const run = await api.invoke<RunState | null>('agent:loadRun', root, runId).catch(() => null)
  const st = useStore.getState()
  if (!run) {
    st.patchProject(root, (c) => ({ chats: c.chats.map((t) => (t.key === key ? { ...t, runId: null } : t)), ...(c.chat === key && c.runId === runId ? { runId: null } : {}) }))
    return persist(root)
  }
  const snap: ChatSnap = { runId: run.id, status: run.status, transcript: run.transcript, live: '', liveReasoning: '', plan: run.plan, turnStartedAt: null }
  const retitle = (t: ChatTab): ChatTab => ({ ...t, runId: run.id, status: run.status, title: t.title === NEW_CHAT ? titleFrom(run.objective) : t.title })
  st.patchProject(root, (c) => {
    if (c.chat === key) {
      if (isBusy(c.status)) return {}
      const agents = { ...c.agents, ...Object.fromEntries((run.agents ?? []).map((a) => [a.id, a])) }
      return { ...snap, agents, chats: c.chats.map((t) => (t.key === key ? retitle(t) : t)) }
    }
    return { chats: c.chats.map((t) => (t.key === key ? { ...retitle(t), snap } : t)) }
  })
  persist(root)
}

export function switchChat(root: string, key: string): void {
  flushDeltas()
  const st = useStore.getState()
  const c = st.project(root)
  const target = c.chats.find((t) => t.key === key)
  if (c.chat === key || !target) return
  const cur = pickSnap(c)
  const load = target.snap ?? { ...blankSnap(), runId: target.runId, status: target.status }
  st.patchProject(root, {
    ...load,
    chat: key,
    chats: c.chats.map((t) => (t.key === c.chat ? { ...t, snap: cur, runId: cur.runId, status: cur.status } : t.key === key ? { ...t, snap: null } : t))
  })
  persist(root)
  if (!target.snap && target.runId) void fillFromRun(root, key, target.runId)
}

const isEmpty = (c: ReturnType<typeof useStore.getState>['projects'][string], t: ChatTab): boolean =>
  t.key === c.chat ? !c.runId && !c.transcript.length && !isBusy(c.status) : !t.runId && !t.snap?.transcript.length

/** Open a new chat tab, or go to an empty one that is already open. Returns false when the tab limit is reached. */
export function newChat(root: string): boolean {
  const st = useStore.getState()
  const c = st.project(root)
  const blank = c.chats.find((t) => isEmpty(c, t))
  if (blank) return switchChat(root, blank.key), true
  if (c.chats.length >= MAX_CHATS) return st.notify(`Up to ${MAX_CHATS} chats can be open per project. Close one first.`, 'error'), false
  const t = newTab()
  st.patchProject(root, (cc) => ({ chats: [...cc.chats, t] }))
  switchChat(root, t.key)
  return true
}

export function closeChat(root: string, key: string): void {
  const st = useStore.getState()
  const c = st.project(root)
  const t = c.chats.find((x) => x.key === key)
  if (!t) return
  if (isBusy(key === c.chat ? c.status : t.status)) return st.notify('This chat is still working. Cancel it before closing the tab.', 'error')
  const rest = c.chats.filter((x) => x.key !== key)
  if (!rest.length) {
    const n = newTab()
    st.patchProject(root, { ...blankSnap(), chats: [n], chat: n.key, startingChat: null })
    return persist(root)
  }
  if (key === c.chat) switchChat(root, rest[Math.min(c.chats.indexOf(t), rest.length - 1)].key)
  st.patchProject(root, (cc) => ({ chats: cc.chats.filter((x) => x.key !== key) }))
  persist(root)
}

/** Show a saved run: its tab if it is open, otherwise the empty active chat or a new tab. */
export async function openRunInChat(root: string, runId: string): Promise<void> {
  const st = useStore.getState()
  const c = st.project(root)
  const open = c.chats.find((t) => (t.key === c.chat ? c.runId : t.runId) === runId)
  if (open) {
    switchChat(root, open.key)
    // a restored tab may still be loading: make sure its history is on screen before the caller continues the run
    const now = useStore.getState().project(root)
    if (now.chat === open.key && now.runId === runId && !now.transcript.length) await fillFromRun(root, open.key, runId)
    return
  }
  const active = c.chats.find((t) => t.key === c.chat)
  if (!(active && isEmpty(c, active)) && !newChat(root)) return
  const key = useStore.getState().project(root).chat
  st.patchProject(root, (cc) => ({ runId, chats: cc.chats.map((t) => (t.key === key ? { ...t, runId } : t)) }))
  await fillFromRun(root, key, runId)
}

/** Mark the active chat as the one starting a run, and name it after the first message. Returns its key. */
export function beginRun(root: string, text: string): string {
  const st = useStore.getState()
  const key = st.project(root).chat
  st.patchProject(root, (c) => ({ startingChat: key, chats: c.chats.map((t) => (t.key === key && t.title === NEW_CHAT ? { ...t, title: titleFrom(text) } : t)) }))
  persist(root)
  return key
}

/** After agent:start returns: make sure the chat that started the run owns it (events usually got there first). */
export function attachRun(root: string, key: string, runId: string | null): void {
  useStore.getState().patchProject(root, (c) => {
    const startingChat = c.startingChat === key ? null : c.startingChat
    if (!runId) return { startingChat }
    if (c.chat === key) return { startingChat, ...(c.runId ? {} : { runId }), chats: c.chats.map((t) => (t.key === key && !t.runId ? { ...t, runId } : t)) }
    return { startingChat, chats: c.chats.map((t) => (t.key === key && !t.runId ? { ...t, runId, snap: t.snap ? { ...t.snap, runId } : t.snap } : t)) }
  })
  persist(root)
}

/** A chat other than the active one that is still working, if any (one task runs per project at a time). */
export function otherBusyChat(root: string): ChatTab | undefined {
  const c = useStore.getState().project(root)
  return c.chats.find((t) => t.key !== c.chat && isBusy(t.status))
}
