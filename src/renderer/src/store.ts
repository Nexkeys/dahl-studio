import { create } from 'zustand'
import type {
  AgentEvent, AgentInfo, AgentMode, Attachment, KeyInfo, KeyUsageLocal, ModelInfo, PendingApproval, PlanStep, ProviderId, RunStatus, RunSummary, Settings, TranscriptItem
} from '@shared/types'

export const api = window.dahl

export type View = 'workspace' | 'git' | 'agents' | 'tasks' | 'reasoning' | 'toolbox' | 'memory' | 'logs' | 'storage' | 'settings'

export interface Tab {
  path: string
  content: string
  saved: string
}

export interface ProjectUI {
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

const emptyProject = (): ProjectUI => ({
  tabs: [], active: null, runId: null, status: null, transcript: [], live: '', liveReasoning: '', plan: [], approvals: [], reviewing: null, treeVersion: 0, attachments: [], agents: {}, turnStartedAt: null
})

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
  composerInsert: string | null
  set: (p: Partial<State>) => void
  project: (root: string) => ProjectUI
  patchProject: (root: string, p: Partial<ProjectUI> | ((cur: ProjectUI) => Partial<ProjectUI>)) => void
  notify: (text: string, kind?: 'info' | 'error') => void
}

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
  composerInsert: null,
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

export function handleAgentEvent(e: AgentEvent): void {
  const st = useStore.getState()
  const root = e.project
  switch (e.type) {
    case 'delta':
      st.patchProject(root, (c) => ({ live: c.live + (e.delta ?? '') }))
      break
    case 'reasoning_delta':
      st.patchProject(root, (c) => ({ liveReasoning: c.liveReasoning + (e.delta ?? '') }))
      break
    case 'transcript': {
      const item = e.item!
      st.patchProject(root, (c) => ({
        transcript: [...c.transcript, item],
        live: item.kind === 'assistant' ? '' : c.live,
        liveReasoning: item.kind === 'reasoning' ? '' : c.liveReasoning,
        runId: e.runId
      }))
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
      st.patchProject(root, { plan: e.plan ?? [] })
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
      st.patchProject(root, (c) => ({
        status: e.status ?? c.status,
        runId: e.runId,
        live: running ? c.live : '',
        liveReasoning: running ? c.liveReasoning : '',
        turnStartedAt: running ? c.turnStartedAt ?? Date.now() : null
      }))
      break
    }
  }
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

export const PROVIDER_NAMES: Record<ProviderId, string> = { dahl: 'Dahl', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', nvidia: 'NVIDIA' }
