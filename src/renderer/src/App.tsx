import { lazy, Suspense, useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { LayoutPanelLeft, ListChecks, Brain, BrainCircuit, Settings as SettingsIcon, HardDrive, FolderPlus, X, GitBranch, PanelBottom, CircleAlert, Users, Boxes, ScrollText, Command, Eye, Globe } from 'lucide-react'
import type { KeyInfo, KeyUsageLocal, ModelInfo, Settings } from '@shared/types'
import { isLocalProvider } from '@shared/models'
import { api, baseName, ensureDefaultModel, handleAgentEvent, loadModels, openPreview, PROVIDER_NAMES, updateSettings, useStore, type View } from './store'
import { applyEffects, applyTheme, detectLowEnd } from './themes'
import { overallStatus } from './chatState'
import { onLayoutKey, panels } from './layout'
import { notesSince } from './whatsNew'
import { handleResumeOffer } from './resume'
import { isBusy } from './chatState'
import { ResumeCard } from './components/ResumeCard'
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
import { CompletionStatus } from './components/CompletionStatus'
import { CostStatus } from './components/CostStatus'
import iconUrl from './assets/icon.png'

// the preview browser (and its <webview>) loads only when the panel is first opened
const WhatsNew = lazy(() => import('./components/WhatsNew').then((m) => ({ default: m.WhatsNew })))
const PreviewPanel = lazy(() => import('./components/PreviewPanel').then((m) => ({ default: m.PreviewPanel })))

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
  const status = useStore((s) => (root ? overallStatus(s.projects[root]) : null))
  const agents = useStore((s) => (root ? Object.values(s.projects[root]?.agents ?? {}).filter((a) => !a.endedAt).length : 0))
  const showTerminal = useStore((s) => s.showTerminal)
  const showPreview = useStore((s) => s.showPreview)
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
  // a local model is listed only while its server answers, so being listed means it is ready
  const local = isLocalProvider(provider)
  const ok = local || keys.some((k) => k.provider === provider && k.configured && k.health !== 'auth_failed' && k.health !== 'exhausted')
  return (
    <div className="statusbar">
      <span className={`dot ${ok ? 'ok' : 'bad'}`} /> {ok ? `${PROVIDER_NAMES[provider]}${local ? ' (local)' : ''} ready` : `No usable ${PROVIDER_NAMES[provider]} key`}
      {model && <span className="sb-item">{model.label}{model.vision && <Eye size={11} />}</span>}
      {git?.repo && <button className="sb-btn sb-item" onClick={() => set({ view: 'git' })}><GitBranch size={12} /> {git.branch ?? 'detached'}{git.files.length ? ` · ${git.files.length} changed` : ''}</button>}
      {agents > 0 && <button className="sb-btn sb-item" onClick={() => set({ view: 'agents' })}><Users size={12} /> {agents} agents running</button>}
      <CostStatus />
      <span className="grow" />
      <UpdateBadge />
      {root && <CompletionStatus />}
      <button className="sb-btn" onClick={() => set({ palette: true })}><Command size={12} /> Ctrl+K</button>
      {root && <button className="sb-btn" onClick={() => set({ showTerminal: !showTerminal })} aria-pressed={showTerminal}><PanelBottom size={12} /> Terminal</button>}
      {root && <button className="sb-btn" title="Preview" onClick={() => (showPreview ? set({ showPreview: false }) : openPreview(root))} aria-pressed={showPreview}><Globe size={12} /> Preview</button>}
    </div>
  )
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  const showTerminal = useStore((s) => s.showTerminal)
  const showPreview = useStore((s) => s.showPreview)
  const whatsNew = useStore((s) => s.whatsNew)
  const set = useStore((s) => s.set)

  useEffect(() => {
    ;(async () => {
      try {
        const s = await api.invoke<Settings>('settings:get')
        applyTheme(s.theme)
        const [keys, usage, info] = await Promise.all([
          api.invoke<KeyInfo[]>('keys:list'), api.invoke<Record<string, KeyUsageLocal>>('usage:get'), api.invoke<{ gpu: string; cpus: number; version: string }>('app:info')
        ])
        detectLowEnd(info)
        applyEffects(s.effects)
        set({ settings: s, keys, usage, ready: true, web: s.webResearch, appVersion: info.version })
        // after an update, show what is new once; a fresh install just records the version
        if (s.lastSeenVersion !== info.version) {
          if (s.lastSeenVersion && notesSince(s.lastSeenVersion, info.version).length) set({ whatsNew: { since: s.lastSeenVersion } })
          else void updateSettings({ lastSeenVersion: info.version })
        }
        // tasks a restart interrupted: continue them after an update, offer to after a quit or crash
        void handleResumeOffer()
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
    window.addEventListener('keydown', onLayoutKey, true)
    return () => (offs.forEach((o) => o()), window.removeEventListener('keydown', onLayoutKey, true))
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
          {/* the model menu lives in the chat box (components/ModelMenu.tsx) */}
        </header>

        <div className="content" key={view}>
          {view === 'workspace' && (root ? (
            <Group orientation="horizontal" className="split" id="ws-h">
              <Panel defaultSize="17%" minSize={180} collapsible collapsedSize={0} id="explorer" panelRef={(h) => void (panels.explorer = h)}><Explorer root={root} key={root} /></Panel>
              <Separator className="sep v" />
              <Panel minSize={320} id="center">
                <Group orientation="vertical" id="ws-v">
                  <Panel minSize={160} id="editor">
                    {/* the editor keeps its place in the tree, so toggling Preview never remounts Monaco */}
                    <Group orientation="horizontal" id="ws-preview">
                      <Panel minSize={160} id="editor-main"><EditorArea root={root} /></Panel>
                      {showPreview && <Separator className="sep v" />}
                      {showPreview && (
                        <Panel defaultSize="45%" minSize={220} id="preview">
                          <Suspense fallback={<div className="panel"><div className="empty-state"><span className="spinner" /></div></div>}><PreviewPanel root={root} key={root} /></Suspense>
                        </Panel>
                      )}
                    </Group>
                  </Panel>
                  {showTerminal && <Separator className="sep h" />}
                  {showTerminal && <Panel defaultSize="26%" minSize={90} id="terminal"><TerminalPanel root={root} key={root} /></Panel>}
                </Group>
              </Panel>
              <Separator className="sep v" />
              <Panel defaultSize="34%" minSize={340} collapsible collapsedSize={0} id="chat" panelRef={(h) => void (panels.chat = h)}><ChatPanel root={root} /></Panel>
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
      {whatsNew && <Suspense fallback={null}><WhatsNew /></Suspense>}
      <ResumeCard />
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.kind === 'error' && <CircleAlert size={14} />} {toast.text}</div>}
    </div>
  )
}

interface UpdateStatus { state: string; version?: string; percent?: number; error?: string; current: string; waiting?: boolean }

/** Shows auto-update progress from GitHub Releases; installing only happens when the user clicks Restart. */
function UpdateBadge() {
  const [u, setU] = useState<UpdateStatus | null>(null)
  const [ask, setAsk] = useState(false)
  const busy = useStore((s) => Object.values(s.projects).some((p) => isBusy(overallStatus(p))))
  useEffect(() => {
    void api.invoke<UpdateStatus>('update:status').then(setU)
    return api.on('update:status' as never, (s: UpdateStatus) => setU(s))
  }, [])
  if (!u || u.state === 'dev' || u.state === 'idle' || u.state === 'none' || u.state === 'checking') return null
  if (u.state === 'downloading') return <span className="sb-item">Downloading update {u.version} {u.percent ?? 0}%</span>
  if (u.state === 'ready' && u.waiting)
    return <span className="sb-item">Update {u.version} installs when your tasks finish <button className="link" onClick={() => api.invoke('update:install', 'cancel')}>Cancel</button></span>
  if (u.state === 'ready')
    return (
      <span className="update-wrap">
        <button className="sb-btn sb-item update-ready" onClick={() => (busy ? setAsk(!ask) : void api.invoke('update:install', 'now'))}>Update {u.version} ready. Restart to install</button>
        {ask && busy && (
          <span className="update-pop" role="dialog" aria-label="Install update">
            <b>A task is still running.</b>
            <span className="muted">Its progress is saved either way.</span>
            <button className="btn small ghost" onClick={() => (setAsk(false), void api.invoke('update:install', 'idle'))}>Install when tasks finish</button>
            <button className="btn small primary" onClick={() => (setAsk(false), void api.invoke('update:install', 'now'))}>Restart now and continue them</button>
          </span>
        )}
      </span>
    )
  return <span className="sb-item" title={u.error}>Update check failed</span>
}

function ProjectDot({ root }: { root: string }) {
  const status = useStore((s) => overallStatus(s.projects[root]))
  return <span className={`pdot ${status ?? 'idle'}`} />
}
