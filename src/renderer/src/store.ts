import { create } from 'zustand'
import type {
  AgentEvent, AgentInfo, AgentMode, Attachment, KeyInfo, KeyUsageLocal, ModelInfo, PendingApproval, PlanStep, ProviderId, RunStatus, RunSummary, Settings, TranscriptItem
} from '@shared/types'
import { newTab, patchChat, type ChatFields } from './chatState'
import { markUnread } from './status'
import type { ResumeOffer } from './resume'

export const api = window.dahl

export type View = 'workspace' | 'git' | 'agents' | 'tasks' | 'reasoning' | 'toolbox' | 'memory' | 'logs' | 'storage' | 'settings'

export interface Tab {
  path: string
  content: string
  saved: string
}

export interface ProjectUI extends ChatFields {
  tabs: Tab[]
  active: string | null
  runId: string | null
  status: RunStatus | null
  transcript: TranscriptItem[]
  live: string
  liveReasoning: string
  plan: PlanStep[]
  approvals: PendingApproval[]
  reviewing: string | null
  treeVersion: number
  attachments: Attachment[]
  agents: Record<string, AgentInfo>
  turnStartedAt: number | null
}

const emptyProject = (): ProjectUI => {
  const chat = newTab()
  return {
    tabs: [], active: null, runId: null, status: null, transcript: [], live: '', liveReasoning: '', plan: [], approvals: [], reviewing: null, treeVersion: 0, attachments: [], agents: {}, turnStartedAt: null,
    chats: [chat], chat: chat.key, startingChat: null
  }
}

interface State {
  ready: boolean
  view: View
  settings: Settings | null
  keys: KeyInfo[]
  usage: Record<string, KeyUsageLocal> | null
  models: ModelInfo[]
  modelErrors: Partial<Record<ProviderId, string>>
  mode: AgentMode
  web: boolean
  projects: Record<string, ProjectUI>
  toast: { kind: 'info' | 'error'; text: string } | null
  showTerminal: boolean
  palette: boolean
  /** What's New dialog: since = last version seen (notes after it), or null for the current version's notes */
  whatsNew: { since: string | null } | null
  appVersion: string
  /** tasks interrupted by a quit or crash, offered by the ResumeCard */
  resumeOffer: ResumeOffer | null
  /** Ctrl+P: the palette lists files only */
  paletteFiles: boolean
  composerInsert: string | null
  showPreview: boolean
  /** last Preview URL per project root (also kept in localStorage) */
  previewUrls: Record<string, string>
  set: (p: Partial<State>) => void
  project: (root: string) => ProjectUI
  patchProject: (root: string, p: Partial<ProjectUI> | ((cur: ProjectUI) => Partial<ProjectUI>)) => void
  notify: (text: string, kind?: 'info' | 'error') => void
}

const PREVIEW_KEY = 'dahl.previewUrls'

export const useStore = create<State>((set, get) => ({
  ready: false,
  view: 'workspace',
  settings: null,
  keys: [],
  usage: null,
  models: [],
  modelErrors: {},
  mode: 'build',
  web: true,
  projects: {},
  toast: null,
  showTerminal: true,
  palette: false,
  whatsNew: null,
  appVersion: '',
  resumeOffer: null,
  paletteFiles: false,
  composerInsert: null,
  showPreview: false,
  previewUrls: loadPreviewUrls(),
  set: (p) => set(p),
  project: (root) => get().projects[root] ?? emptyProject(),
  patchProject: (root, p) =>
    set((s) => {
      const cur = s.projects[root] ?? emptyProject()
      const patch = typeof p === 'function' ? p(cur) : p
      return { projects: { ...s.projects, [root]: { ...cur, ...patch } } }
    }),
  notify: (text, kind = 'info') => {
    set({ toast: { kind, text } })
    setTimeout(() => {
      if (get().toast?.text === text) set({ toast: null })
    }, kind === 'error' ? 7000 : 3200)
  }
}))

function loadPreviewUrls(): Record<string, string> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(PREVIEW_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

/** Remember the Preview URL for a project (the panel navigates when it changes). */
export function setPreviewUrl(root: string, url: string): void {
  const st = useStore.getState()
  if (st.previewUrls[root] === url) return
  const previewUrls = { ...st.previewUrls, [root]: url }
  st.set({ previewUrls })
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(previewUrls))
  } catch {
    /* storage full or unavailable */
  }
}

/** Show the Preview panel, optionally navigating it. */
export function openPreview(root: string, url?: string): void {
  if (url) setPreviewUrl(root, url)
  useStore.getState().set({ showPreview: true, view: 'workspace' })
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const s = await api.invoke<Settings>('settings:update', patch)
  useStore.getState().set({ settings: s })
}

export async function loadModels(refresh = false): Promise<void> {
  const st = useStore.getState()
  try {
    const r = await api.invoke<{ models: ModelInfo[]; errors: Partial<Record<ProviderId, string>> }>(refresh ? 'models:refresh' : 'models:list')
    st.set({ models: r.models, modelErrors: r.errors })
    await ensureDefaultModel(r.models)
  } catch (e) {
    st.set({ modelErrors: { dahl: (e as Error).message } })
  }
}

export async function ensureDefaultModel(models: ModelInfo[]): Promise<void> {
  const s = useStore.getState().settings
  if (s && models.length && (!s.defaultModel || !models.some((m) => m.key === s.defaultModel))) {
    const pick = models.find((m) => m.provider === 'dahl') ?? models[0]
    await updateSettings({ defaultModel: pick.key })
  }
}

export async function openFile(root: string, path: string): Promise<void> {
  const st = useStore.getState()
  const p = st.project(root)
  st.set({ view: 'workspace' })
  if (p.tabs.some((t) => t.path === path)) return st.patchProject(root, { active: path, reviewing: null })
  try {
    const content = await api.invoke<string>('fs:read', root, path)
    st.patchProject(root, (cur) => ({ tabs: [...cur.tabs, { path, content, saved: content }], active: path, reviewing: null }))
  } catch (e) {
    st.notify((e as Error).message, 'error')
  }
}

export async function reloadOpenFile(root: string, path: string): Promise<void> {
  const st = useStore.getState()
  const tab = st.project(root).tabs.find((t) => t.path === path)
  if (!tab || tab.content !== tab.saved) return
  try {
    const content = await api.invoke<string>('fs:read', root, path)
    st.patchProject(root, (cur) => ({ tabs: cur.tabs.map((t) => (t.path === path ? { ...t, content, saved: content } : t)) }))
  } catch {
    /* removed */
  }
}

export async function loadRunsSummary(root: string): Promise<RunSummary[]> {
  return api.invoke<RunSummary[]>('agent:runs', root)
}

export function addAttachments(root: string, atts: Attachment[]): void {
  useStore.getState().patchProject(root, (c) => ({ attachments: [...c.attachments, ...atts].slice(0, 20) }))
}

// Streamed tokens arrive in small batches from the main process (every 16 ms). They are applied once per screen frame
// (requestAnimationFrame), so text appears as fast as the model sends it without re-rendering per token. A hidden
// window gets no animation frames, so it falls back to a timer, and everything is flushed when it becomes visible.
const FLUSH_MS = 33
const hasRaf = typeof requestAnimationFrame === 'function' && typeof document !== 'undefined'
let flushFrame: number | null = null
function scheduleFlush(): void {
  if (flushTimer || flushFrame !== null) return
  if (hasRaf && document.visibilityState === 'visible') flushFrame = requestAnimationFrame(() => flushDeltas())
  else flushTimer = setTimeout(flushDeltas, FLUSH_MS)
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => flushDeltas())
// keyed by project and run, because a chat in the background can stream while another one is on screen
const pendingDeltas = new Map<string, { root: string; runId: string; live: string; reasoning: string }>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function flushDeltas(): void {
  if (flushTimer) clearTimeout(flushTimer)
  if (flushFrame !== null) cancelAnimationFrame(flushFrame)
  flushTimer = null
  flushFrame = null
  if (!pendingDeltas.size) return
  const st = useStore.getState()
  for (const d of pendingDeltas.values())
    st.patchProject(d.root, (c) => patchChat(c, d.runId, (s) => ({ runId: d.runId, live: s.live + d.live, liveReasoning: s.liveReasoning + d.reasoning })))
  pendingDeltas.clear()
}

export function handleAgentEvent(e: AgentEvent): void {
  const root = e.project
  if (e.type === 'delta' || e.type === 'reasoning_delta') {
    const key = `${root}
${e.runId}`
    const d = pendingDeltas.get(key) ?? { root, runId: e.runId, live: '', reasoning: '' }
    if (e.type === 'delta') d.live += e.delta ?? ''
    else d.reasoning += e.delta ?? ''
    pendingDeltas.set(key, d)
    scheduleFlush()
    return
  }
  // buffered text must land before an event that ends or replaces the live text
  flushDeltas()
  const st = useStore.getState()
  switch (e.type) {
    case 'transcript': {
      const item = e.item!
      st.patchProject(root, (c) => patchChat(c, e.runId, (s) => ({
        transcript: [...s.transcript, item],
        live: item.kind === 'assistant' || item.resetLive ? '' : s.live,
        liveReasoning: item.kind === 'reasoning' || item.resetLive ? '' : s.liveReasoning,
        runId: e.runId
      })))
      if (item.kind === 'tool' && item.tool?.ok && /^(write_file|edit_file|append_file)$/.test(item.tool.name)) {
        try {
          void reloadOpenFile(root, JSON.parse(item.tool.args).path as string)
        } catch {
          /* ignore */
        }
        st.patchProject(root, (c) => ({ treeVersion: c.treeVersion + 1 }))
      }
      break
    }
    case 'plan':
      st.patchProject(root, (c) => patchChat(c, e.runId, () => ({ plan: e.plan ?? [], runId: e.runId })))
      break
    case 'approval':
      st.patchProject(root, (c) => ({ approvals: [...c.approvals, e.approval!], reviewing: e.approval!.kind === 'write' ? e.approval!.id : c.reviewing }))
      break
    case 'agent':
      st.patchProject(root, (c) => ({ agents: { ...c.agents, [e.agent!.id]: e.agent! } }))
      break
    case 'status':
    case 'run': {
      const running = e.status === 'running' || e.status === 'waiting_approval'
      st.patchProject(root, (c) => patchChat(c, e.runId, (s) => ({
        status: e.status ?? s.status,
        runId: e.runId,
        live: running ? s.live : '',
        liveReasoning: running ? s.liveReasoning : '',
        turnStartedAt: running ? s.turnStartedAt ?? Date.now() : null
      })))
      // a chat that finishes while you look elsewhere shows "done, not seen" until you open it
      if (e.status === 'completed') {
        const onScreen = st.settings?.activeProject === root && st.view === 'workspace' && (typeof document === 'undefined' || document.visibilityState === 'visible')
        const unread = markUnread(st.project(root), e.runId, onScreen)
        if (unread) st.patchProject(root, unread)
      }
      break
    }
  }
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

export const PROVIDER_NAMES: Record<ProviderId, string> = { dahl: 'Dahl', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', nvidia: 'NVIDIA' }
