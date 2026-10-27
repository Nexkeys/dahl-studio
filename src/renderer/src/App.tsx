import { useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { LayoutPanelLeft, ListChecks, Brain, BrainCircuit, Settings as SettingsIcon, HardDrive, FolderPlus, X, GitBranch, PanelBottom, CircleAlert, Users, Boxes, ScrollText, Command, Eye } from 'lucide-react'
import type { KeyInfo, KeyUsageLocal, ModelInfo, Settings } from '@shared/types'
import { api, baseName, ensureDefaultModel, handleAgentEvent, loadModels, PROVIDER_NAMES, updateSettings, useStore, type View } from './store'
import { applyEffects, applyTheme, detectLowEnd } from './themes'
import { preloadMonaco } from './lazyMonaco'
import { Explorer } from './components/Explorer'
import { EditorArea } from './components/EditorArea'
import { ChatPanel } from './components/ChatPanel'
import { TerminalPanel } from './components/TerminalPanel'
import { TasksView, MemoryView, StorageView, Welcome } from './components/Views'
import { SettingsView } from './components/SettingsView'
import { ReasoningView } from './components/ReasoningView'
import { AgentsView } from './components/AgentsView'
import { ToolboxView } from './components/ToolboxView'
import { GitView } from './components/GitView'
import { LogsView } from './components/LogsView'
import { CommandPalette } from './components/CommandPalette'
import iconUrl from './assets/icon.png'

const NAV: { id: View; label: string; icon: typeof Brain }[] = [
  { id: 'workspace', label: 'Workspace', icon: LayoutPanelLeft },
  { id: 'git', label: 'Source Control', icon: GitBranch },
  { id: 'agents', label: 'Agents', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'reasoning', label: 'Reasoning', icon: BrainCircuit },
  { id: 'toolbox', label: 'Free Toolbox', icon: Boxes },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'storage', label: 'Storage', icon: HardDrive }
]

async function openProject(): Promise<void> {
  const st = useStore.getState()
  try {
    const dir = await api.invoke<string | null>('project:pick')
    if (!dir) return
    st.set({ settings: await api.invoke<Settings>('project:open', dir), view: 'workspace' })
  } catch (e) {
    st.notify((e as Error).message, 'error')
  }
}

function StatusBar({ root }: { root: string | null }) {
  const keys = useStore((s) => s.keys)
  const model = useStore((s) => s.models.find((m) => m.key === s.settings?.defaultModel))
  const status = useStore((s) => (root ? s.projects[root]?.status : null))
  const agents = useStore((s) => (root ? Object.values(s.projects[root]?.agents ?? {}).filter((a) => !a.endedAt).length : 0))
  const showTerminal = useStore((s) => s.showTerminal)
  const set = useStore((s) => s.set)
  const [git, setGit] = useState<{ repo: boolean; branch: string | null; files: unknown[] } | null>(null)
  useEffect(() => {
    if (!root) return setGit(null)
    const load = () => api.invoke<typeof git>('git:status', root).then(setGit).catch(() => setGit(null))
    void load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [root, status])
  const provider = model?.provider ?? 'dahl'
  const ok = keys.some((k) => k.provider === provider && k.configured && k.health !== 'auth_failed' && k.health !== 'exhausted')
  return (
    <div className="statusbar">
      <span className={`dot ${ok ? 'ok' : 'bad'}`} /> {ok ? `${PROVIDER_NAMES[provider]} ready` : `No usable ${PROVIDER_NAMES[provider]} key`}
      {model && <span className="sb-item">{model.label}{model.vision && <Eye size={11} />}</span>}
      {git?.repo && <button className="sb-btn sb-item" onClick={() => set({ view: 'git' })}><GitBranch size={12} /> {git.branch ?? 'detached'}{git.files.length ? ` · ${git.files.length} changed` : ''}</button>}
      {agents > 0 && <button className="sb-btn sb-item" onClick={() => set({ view: 'agents' })}><Users size={12} /> {agents} agents running</button>}
      <span className="grow" />
      <UpdateBadge />
      <button className="sb-btn" onClick={() => set({ palette: true })}><Command size={12} /> Ctrl+K</button>
      {root && <button className="sb-btn" onClick={() => set({ showTerminal: !showTerminal })} aria-pressed={showTerminal}><PanelBottom size={12} /> Terminal</button>}
    </div>
  )
}

function ModelPicker() {
  const s = useStore((st) => st.settings)
  const models = useStore((st) => st.models)
  const providers = [...new Set(models.map((m) => m.provider))]
  return (
    <div className="model-picker">
      <select className="input small" value={s?.defaultModel ?? ''} onChange={(e) => updateSettings({ defaultModel: e.target.value })} aria-label="Model">
        {!models.length && <option value="">Loading models</option>}
        {providers.map((p) => (
          <optgroup key={p} label={PROVIDER_NAMES[p]}>
            {models.filter((m) => m.provider === p).map((m) => <option key={m.key} value={m.key}>{m.label}{m.isNew ? '  (new)' : ''}{m.vision ? '  [vision]' : ''}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  const showTerminal = useStore((s) => s.showTerminal)
  const set = useStore((s) => s.set)

  useEffect(() => {
    ;(async () => {
      try {
        const s = await api.invoke<Settings>('settings:get')
        applyTheme(s.theme)
        const [keys, usage, info] = await Promise.all([
          api.invoke<KeyInfo[]>('keys:list'), api.invoke<Record<string, KeyUsageLocal>>('usage:get'), api.invoke<{ gpu: string; cpus: number }>('app:info')
        ])
        detectLowEnd(info)
        applyEffects(s.effects)
        set({ settings: s, keys, usage, ready: true, web: s.webResearch })
        void loadModels()
        // parse the editor bundle once the window is up and idle, so opening the first file is instant
        setTimeout(() => requestIdleCallback(preloadMonaco), 1500)
      } catch (e) {
        set({ ready: true })
        useStore.getState().notify(`Startup problem: ${(e as Error).message}`, 'error')
      }
    })()
    const offs = [
      api.on('agent:event', handleAgentEvent),
      api.on('keys:changed', (keys) => set({ keys })),
      api.on('usage:changed', (usage) => set({ usage })),
      api.on('app:focusProject' as never, (p: string) => (set({ view: 'workspace' }), void updateSettings({ activeProject: p }))),
      api.on('models:changed' as never, (models: ModelInfo[]) => (set({ models }), void ensureDefaultModel(models)))
    ]
    return () => offs.forEach((o) => o())
  }, [set])

  const root = settings?.activeProject ?? null
  const projects = settings?.openProjects ?? []
  const closeProject = async (p: string) => {
    try {
      set({ settings: await api.invoke<Settings>('project:close', p) })
    } catch (e) {
      useStore.getState().notify((e as Error).message, 'error')
    }
  }

  if (!ready) return <div className="boot"><img src={iconUrl} alt="Dahl Studio" /></div>

  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <img src={iconUrl} alt="Dahl Studio" className="rail-logo" />
        {NAV.map((n) => (
          <button key={n.id} className={`rail-btn ${view === n.id ? 'on' : ''}`} onClick={() => set({ view: n.id })} aria-label={n.label} aria-current={view === n.id}>
            <n.icon size={19} strokeWidth={1.7} /><span className="rail-tip">{n.label}</span>
          </button>
        ))}
        <span className="grow" />
        <button className={`rail-btn ${view === 'settings' ? 'on' : ''}`} onClick={() => set({ view: 'settings' })} aria-label="Settings"><SettingsIcon size={19} strokeWidth={1.7} /><span className="rail-tip">Settings</span></button>
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="project-tabs" role="tablist" aria-label="Open projects">
            {projects.map((p) => (
              <div key={p} role="tab" aria-selected={p === root} className={`ptab ${p === root ? 'on' : ''}`} onClick={() => updateSettings({ activeProject: p })} title={p}>
                <ProjectDot root={p} /><span>{baseName(p)}</span>
                <button className="tab-close" aria-label={`Close ${baseName(p)}`} onClick={(e) => { e.stopPropagation(); void closeProject(p) }}><X size={12} /></button>
              </div>
            ))}
            <button className="btn small ghost" onClick={openProject}><FolderPlus size={14} /> Open folder</button>
          </div>
          <ModelPicker />
        </header>

        <div className="content" key={view}>
          {view === 'workspace' && (root ? (
            <Group orientation="horizontal" className="split" id="ws-h">
              <Panel defaultSize="17%" minSize={180} collapsible collapsedSize={0} id="explorer"><Explorer root={root} key={root} /></Panel>
              <Separator className="sep v" />
              <Panel minSize={320} id="center">
                <Group orientation="vertical" id="ws-v">
                  <Panel minSize={160} id="editor"><EditorArea root={root} /></Panel>
                  {showTerminal && <Separator className="sep h" />}
                  {showTerminal && <Panel defaultSize="26%" minSize={90} id="terminal"><TerminalPanel root={root} key={root} /></Panel>}
                </Group>
              </Panel>
              <Separator className="sep v" />
              <Panel defaultSize="34%" minSize={340} collapsible collapsedSize={0} id="chat"><ChatPanel root={root} /></Panel>
            </Group>
          ) : <Welcome onOpen={openProject} />)}
          {view === 'git' && <GitView />}
          {view === 'agents' && <AgentsView />}
          {view === 'tasks' && <TasksView />}
          {view === 'reasoning' && <ReasoningView />}
          {view === 'toolbox' && <ToolboxView />}
          {view === 'memory' && <MemoryView />}
          {view === 'logs' && <LogsView />}
          {view === 'storage' && <StorageView />}
          {view === 'settings' && <SettingsView />}
        </div>
        <StatusBar root={root} />
      </div>
      <CommandPalette />
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.kind === 'error' && <CircleAlert size={14} />} {toast.text}</div>}
    </div>
  )
}

interface UpdateStatus { state: string; version?: string; percent?: number; error?: string; current: string }

/** Shows auto-update progress from GitHub Releases; installing only happens when the user clicks Restart. */
function UpdateBadge() {
  const [u, setU] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void api.invoke<UpdateStatus>('update:status').then(setU)
    return api.on('update:status' as never, (s: UpdateStatus) => setU(s))
  }, [])
  if (!u || u.state === 'dev' || u.state === 'idle' || u.state === 'none' || u.state === 'checking') return null
  if (u.state === 'downloading') return <span className="sb-item">Downloading update {u.version} {u.percent ?? 0}%</span>
  if (u.state === 'ready')
    return <button className="sb-btn sb-item update-ready" onClick={() => api.invoke('update:install')}>Update {u.version} ready. Restart to install</button>
  return <span className="sb-item" title={u.error}>Update check failed</span>
}

function ProjectDot({ root }: { root: string }) {
  const status = useStore((s) => s.projects[root]?.status)
  return <span className={`pdot ${status ?? 'idle'}`} />
}
