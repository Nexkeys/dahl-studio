import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Bug, X, FileCode, Globe } from 'lucide-react'
import { fileUrlFor, isAllowedPreviewUrl, normalizePreviewUrl, projectRel } from '@shared/preview'
import { api, baseName, setPreviewUrl, useStore } from '../store'
import '../ui-preview.css'

/** The parts of Electron's <webview> element the panel uses (the renderer has no Electron types). */
interface WebviewEl extends HTMLWebViewElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  openDevTools(): void
}

const PARTITION = 'persist:dahl-preview'
const isPage = (p: string | null): p is string => !!p && /\.(html?|xhtml|svg)$/i.test(p)

/**
 * Built-in browser for dev servers and static pages. Mounted only while the panel is open. The guest is hardened in
 * the main process (no preload, sandbox, own session, file: limited to the active project).
 */
export function PreviewPanel({ root }: { root: string }) {
  const url = useStore((s) => s.previewUrls[root] ?? '')
  const activePath = useStore((s) => s.projects[root]?.active ?? null)
  const set = useStore((s) => s.set)
  const [draft, setDraft] = useState(url)
  const [nav, setNav] = useState({ back: false, fwd: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const view = useRef<WebviewEl>(null)
  const box = useRef<HTMLDivElement>(null)
  const ready = useRef(false)
  const startUrl = useRef('')
  if (url && !startUrl.current) startUrl.current = url
  const shown = (u: string) => {
    const rel = u.startsWith('file:') ? projectRel(root, u) : null
    return isPage(rel) ? rel : u
  }

  // address bar follows the page; the store keeps the last URL per project
  useEffect(() => setDraft(shown(url)), [url, root])

  const go = (input: string) => {
    const u = normalizePreviewUrl(input, root)
    if (!u) return useStore.getState().notify('Enter a URL like localhost:5173 or a project file like index.html', 'error')
    if (!isAllowedPreviewUrl(u, root)) return useStore.getState().notify('Preview shows http(s) pages and files inside this project only.', 'error')
    setError(null)
    if (u === url && view.current && ready.current) view.current.reload()
    else setPreviewUrl(root, u)
  }

  // navigate when the stored URL changes (typed, terminal link, "Preview this file")
  useEffect(() => {
    const wv = view.current
    if (!wv || !url) return
    if (!ready.current) {
      if (wv.getAttribute('src') !== url) wv.setAttribute('src', url)
    } else if (wv.getURL() !== url) void wv.loadURL(url).catch(() => {})
  }, [url])

  const hasView = !!url
  useEffect(() => {
    const wv = view.current
    if (!wv) return
    const sync = () => setNav({ back: wv.canGoBack(), fwd: wv.canGoForward() })
    const onNav = (e: Event) => {
      const ev = e as Event & { url: string; isMainFrame?: boolean }
      if (ev.isMainFrame === false || !/^(https?|file):/.test(ev.url)) return
      setPreviewUrl(root, ev.url)
      setDraft(shown(ev.url))
      sync()
    }
    const onFail = (e: Event) => {
      const ev = e as Event & { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean }
      if (!ev.isMainFrame || ev.errorCode === -3) return
      setError(ev.errorCode === -20 ? 'Blocked: Preview shows http(s) pages and files inside this project only.' : `${ev.errorDescription || 'Load failed'} (${ev.validatedURL})`)
    }
    const handlers: [string, (e: Event) => void][] = [
      ['dom-ready', () => ((ready.current = true), sync())],
      ['did-start-loading', () => (setLoading(true), setError(null))],
      ['did-stop-loading', () => (setLoading(false), sync())],
      ['did-navigate', onNav],
      ['did-navigate-in-page', onNav],
      ['did-fail-load', onFail]
    ]
    for (const [n, h] of handlers) wv.addEventListener(n, h)
    return () => {
      ready.current = false
      for (const [n, h] of handlers) wv.removeEventListener(n, h)
    }
  }, [hasView, root])

  // Static files have no dev server to push changes: reload (debounced) when the agent writes or the user saves.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = useStore.subscribe((s, prev) => {
      const a = s.projects[root]
      const b = prev.projects[root]
      if (!a || !b || a === b) return
      const saved = a.tabs !== b.tabs && a.tabs.some((t) => { const o = b.tabs.find((x) => x.path === t.path); return !!o && o.saved !== t.saved })
      if (a.treeVersion === b.treeVersion && !saved) return
      const wv = view.current
      if (!wv || !ready.current || !wv.getURL().startsWith('file:')) return
      clearTimeout(timer)
      timer = setTimeout(() => wv.reload(), 350)
    })
    return () => (clearTimeout(timer), off())
  }, [root])

  // the guest swallows pointer events, which would stall dragging a neighbouring panel separator
  useEffect(() => {
    const down = (e: PointerEvent) => (e.target as Element | null)?.closest?.('[data-separator]') && box.current?.classList.add('dragging')
    const up = () => box.current?.classList.remove('dragging')
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    return () => (window.removeEventListener('pointerdown', down, true), window.removeEventListener('pointerup', up, true))
  }, [])

  const openExternal = () => {
    const rel = url.startsWith('file:') ? projectRel(root, url) : null
    if (rel) void api.invoke('fs:openExternal', root, rel)
    else if (/^https?:/.test(url)) window.open(url) // the main window sends http(s) popups to the system browser
  }
  const pageFile = isPage(activePath) && fileUrlFor(`${root}/${activePath}`) !== url ? activePath : null

  return (
    <div className="panel preview" ref={box}>
      <div className="panel-head preview-bar">
        <button className="icon-btn" title="Back" aria-label="Back" disabled={!nav.back} onClick={() => view.current?.goBack()}><ArrowLeft size={14} /></button>
        <button className="icon-btn" title="Forward" aria-label="Forward" disabled={!nav.fwd} onClick={() => view.current?.goForward()}><ArrowRight size={14} /></button>
        <button className="icon-btn" title="Reload" aria-label="Reload" disabled={!url} onClick={() => go(url)}>{loading ? <span className="spinner" /> : <RotateCw size={14} />}</button>
        <input className="input small preview-url" value={draft} spellCheck={false} aria-label="Preview URL" placeholder="localhost:5173 or index.html"
          onChange={(e) => setDraft(e.target.value)} onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(draft)
            if (e.key === 'Escape') setDraft(shown(url))
          }} />
        {pageFile && <button className="icon-btn on" title={`Preview this file (${baseName(pageFile)})`} aria-label={`Preview ${pageFile}`} onClick={() => go(pageFile)}><FileCode size={14} /></button>}
        <button className="icon-btn" title="Open in system browser" aria-label="Open in system browser" disabled={!url} onClick={openExternal}><ExternalLink size={14} /></button>
        <button className="icon-btn" title="Preview DevTools" aria-label="Open DevTools for the preview" disabled={!url} onClick={() => view.current?.openDevTools()}><Bug size={14} /></button>
        <button className="icon-btn" title="Close preview" aria-label="Close preview" onClick={() => set({ showPreview: false })}><X size={14} /></button>
      </div>
      <div className="preview-body">
        {hasView ? <webview ref={view} className="preview-view" partition={PARTITION} src={startUrl.current} /> : (
          <div className="empty-state">
            <Globe size={22} />
            <div className="empty-title">Preview</div>
            <div className="small">Type a dev server address (5173, localhost:3000) or a project file (index.html) and press Enter.</div>
            {pageFile && <button className="btn small" onClick={() => go(pageFile)}><FileCode size={13} /> Preview {pageFile}</button>}
          </div>
        )}
        {error && <div className="preview-error" role="alert"><span className="ellipsis">{error}</span><button className="btn small ghost" onClick={() => go(url)}>Retry</button></div>}
      </div>
    </div>
  )
}
