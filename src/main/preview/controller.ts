// Drives the Preview pane's <webview> guest for the agent (browser_* tools). The guest only ever comes from the
// main window's 'did-attach-webview' event (never from an id the renderer sends). It is controlled through
// webContents.debugger (CDP) with an allow-list of methods, and re-attached after DevTools or a lost connection.
import type { WebContents } from 'electron'
import { RefTable, formatSnapshot, type AXNode } from './snapshot'
import { RingBuffer, consoleLevel, type ConsoleEntry, type NetEntry } from './logs'
import { parseKeyCombo } from './keys'
import type { BrowserBridge, PageInfo } from '../agent/browserTools'

/** The only CDP methods the agent's tools may send. Nothing here reads cookies, storage or other sites. */
const CDP_ALLOWED = new Set([
  'Network.enable', 'Page.enable', 'DOM.enable', 'Overlay.enable', 'Accessibility.getFullAXTree', 'DOM.scrollIntoViewIfNeeded', 'DOM.getContentQuads',
  'DOM.focus', 'DOM.resolveNode', 'Overlay.highlightNode', 'Overlay.hideHighlight', 'Runtime.callFunctionOn', 'Runtime.evaluate', 'Runtime.releaseObjectGroup',
  'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Page.captureScreenshot', 'Page.getLayoutMetrics'
])
const GROUP = 'dahl-agent'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
const sameUrl = (a: string, b: string) => a.replace(/#.*$/, '') === b.replace(/#.*$/, '')

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms)))]).finally(() => clearTimeout(t))
}

export interface PreviewDeps {
  /** ask the renderer to show the Preview pane for this project (and load `url` when it has no page yet) */
  show(root: string, url?: string): void
  activeProject(): Promise<string | null>
  log(msg: string): void
}

export class PreviewController implements BrowserBridge {
  private guest: WebContents | null = null
  private seq = 0
  private refs = new RefTable()
  private readonly consoleLog = new RingBuffer<ConsoleEntry>(300)
  private readonly netLog = new RingBuffer<NetEntry>(300)
  private pending = new Map<string, NetEntry & { logged?: boolean }>()
  /** the current guest began its first navigation (its own src load, which a fresh open waits for) */
  private started = false
  /** main-frame load error of the current page, if its last load failed */
  private loadError: string | undefined
  constructor(private deps: PreviewDeps) {}

  /** A <webview> guest was attached to the main window (index.ts). The newest one is the Preview page. */
  adopt(g: WebContents): void {
    this.guest = g
    this.seq++
    this.started = false
    this.loadError = undefined
    this.newDocument()
    // Electron's typed overloads differ between versions; these events carry a details object plus positional args
    const on = g.on.bind(g) as (event: string, fn: (...a: any[]) => void) => void
    on('console-message', (e: { level?: unknown; message?: string; lineNumber?: number; sourceId?: string }, ...rest: unknown[]) => {
      const message = e.message ?? String(rest[1] ?? '')
      // Electron's own warning about the page's CSP (unpackaged runs only) is not the page's problem
      if (message && !/^\W*Electron Security Warning/.test(message)) this.consoleLog.push({ at: Date.now(), level: consoleLevel(e.level ?? rest[0]), text: message, source: e.sourceId ?? (rest[3] as string | undefined), line: e.lineNumber ?? (rest[2] as number | undefined) })
    })
    on('did-start-navigation', (e: { isMainFrame?: boolean; isSameDocument?: boolean }, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (!(e.isMainFrame ?? mainFrame) || (e.isSameDocument ?? inPlace) || g !== this.guest) return
      this.started = true
      this.loadError = undefined
      this.newDocument()
    })
    on('did-fail-load', (_e: unknown, code: number, desc: string, _url: string, mainFrame: boolean) => {
      if (mainFrame && code !== -3 && g === this.guest) this.loadError = `${desc || 'load failed'} (${code})`
    })
    // opening the Preview DevTools takes the debugger away: attach again once it is open, and after it closes
    on('devtools-opened', () => (this.deps.log(`preview devtools opened (debugger attached: ${g.debugger.isAttached()})`), setTimeout(() => this.attach(g), 700)))
    on('devtools-closed', () => setTimeout(() => this.attach(g), 200))
    g.debugger.on('detach', (_e, reason) => {
      this.deps.log(`preview debugger detached: ${reason}`)
      if (!g.isDestroyed()) setTimeout(() => this.attach(g), 700)
    })
    g.debugger.on('message', (_e, method, params) => this.onCdp(method, params))
    g.once('destroyed', () => {
      if (this.guest === g) this.guest = null
    })
    this.attach(g)
  }

  private newDocument(): void {
    this.refs.reset()
    this.consoleLog.clear()
    this.netLog.clear()
    this.pending.clear()
  }

  private attach(g: WebContents): void {
    if (g.isDestroyed() || g !== this.guest) return
    try {
      if (!g.debugger.isAttached()) g.debugger.attach('1.3')
    } catch (e) {
      return this.deps.log(`preview debugger attach failed: ${(e as Error).message}`)
    }
    // before the first navigation these resolve only once the page exists, so they are never awaited here
    for (const [m, p] of [['Network.enable', { maxTotalBufferSize: 1_000_000, maxResourceBufferSize: 200_000 }], ['Page.enable', {}], ['DOM.enable', {}], ['Overlay.enable', {}]] as const)
      void g.debugger.sendCommand(m, p).catch(() => {})
  }

  private onCdp(method: string, p: any): void {
    type Pending = NetEntry & { logged?: boolean }
    if (method === 'Network.requestWillBeSent') {
      if (/^data:/i.test(p.request?.url ?? '')) return
      this.pending.set(p.requestId, { at: Date.now(), method: p.request.method, url: p.request.url, type: p.type })
      if (this.pending.size > 500) this.pending.delete(this.pending.keys().next().value as string)
    } else if (method === 'Network.responseReceived') {
      // a request seen only from its response (sent before the debugger attached) is still recorded
      const n: Pending = this.pending.get(p.requestId) ?? { at: Date.now(), method: 'GET', url: p.response?.url ?? '', type: p.type }
      Object.assign(n, { status: p.response?.status, statusText: p.response?.statusText || undefined })
      if (/^data:/i.test(n.url) || n.logged) return
      n.logged = true
      this.netLog.push(n)
      this.pending.set(p.requestId, n)
    } else if (method === 'Network.loadingFinished') this.pending.delete(p.requestId)
    else if (method === 'Network.loadingFailed') {
      const n: Pending = this.pending.get(p.requestId) ?? { at: Date.now(), method: 'GET', url: '(unknown)', type: p.type }
      n.error = `${p.errorText ?? 'failed'}${p.blockedReason ? ` (${p.blockedReason})` : ''}${p.canceled ? ' (cancelled)' : ''}`
      if (!n.logged) (n.logged = true), this.netLog.push(n)
      this.pending.delete(p.requestId)
    }
  }

  private live(): WebContents {
    const g = this.guest
    if (!g || g.isDestroyed()) throw new Error('No page is open in the Preview pane. Call browser_open first.')
    return g
  }

  private async cmd<T = any>(method: string, params: Record<string, unknown> = {}, ms = 10000): Promise<T> {
    if (!CDP_ALLOWED.has(method)) throw new Error(`CDP method not allowed: ${method}`)
    const g = this.live()
    if (!g.debugger.isAttached()) this.attach(g)
    if (!g.debugger.isAttached()) throw new Error('The Preview page cannot be controlled right now (its DevTools may be holding it). Close the Preview DevTools and try again.')
    return withTimeout(g.debugger.sendCommand(method, params) as Promise<T>, ms, method)
  }

  private async waitGuest(after: number, ms: number): Promise<WebContents | null> {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (this.seq > after && this.guest && !this.guest.isDestroyed()) return this.guest
    return null
  }

  private async settle(g: WebContents, ms: number): Promise<void> {
    for (const end = Date.now() + ms; Date.now() < end && !g.isDestroyed() && g.isLoading(); ) await sleep(100)
  }

  private info(g: WebContents): PageInfo {
    return { url: g.getURL(), title: g.getTitle() }
  }

  async open(project: string, url: string): Promise<PageInfo & { status?: number; error?: string }> {
    const active = await this.deps.activeProject()
    const reuse = !!active && samePath(active, project) && !!this.guest && !this.guest.isDestroyed()
    const before = this.seq
    this.deps.show(project, reuse ? undefined : url)
    const g = reuse ? this.live() : await this.waitGuest(before, 12000)
    if (!g) return { url, title: '', error: 'the Preview pane did not open (is the Dahl Studio window open?)' }
    let error: string | undefined
    if (!reuse) {
      // a new pane loads `url` itself: wait for that load instead of racing it with a second one
      for (const end = Date.now() + 5000; !this.started && Date.now() < end; ) await sleep(50)
      await this.settle(g, 20000)
      error = this.loadError
    }
    if (reuse || !sameUrl(g.getURL(), url)) error = await withTimeout(g.loadURL(url), 25000, 'Loading the page').then(() => undefined, (e: Error) => e.message.replace(/^.*?(ERR_[A-Z_]+).*$/s, '$1'))
    await this.settle(g, 5000)
    const doc = this.netLog.list().find((n) => n.type === 'Document' && sameUrl(n.url, g.getURL()))
    return { ...this.info(g), status: doc?.status, error: error ?? doc?.error }
  }

  async page(project: string): Promise<PageInfo> {
    const active = await this.deps.activeProject()
    let g: WebContents | null = this.guest && !this.guest.isDestroyed() && active && samePath(active, project) ? this.guest : null
    if (!g) {
      const before = this.seq
      this.deps.show(project)
      g = await this.waitGuest(before, 6000)
      if (!g) throw new Error('No page is open in the Preview pane for this project. Call browser_open with the dev server address or an HTML file first.')
    }
    await this.settle(g, 15000)
    return this.info(g)
  }

  private node(ref: string): number {
    const id = this.refs.node(ref)
    if (id === undefined) throw new Error(`Unknown ref "${ref}". Refs come from browser_snapshot and change when the page reloads; take a new snapshot.`)
    return id
  }

  /** Centre of the element on screen (scrolled into view), or an error the model can act on. */
  private async point(ref: string): Promise<{ id: number; x: number; y: number }> {
    const id = this.node(ref)
    await this.cmd('DOM.scrollIntoViewIfNeeded', { backendNodeId: id }).catch(() => {})
    const r = await this.cmd<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId: id }).catch(() => {
      throw new Error(`Element ${ref} is no longer on the page. Take a new browser_snapshot.`)
    })
    const q = r.quads.find((q) => Math.abs((q[4] - q[0]) * (q[5] - q[1])) > 1)
    if (!q) throw new Error(`Element ${ref} is not visible (it has no size on screen).`)
    return { id, x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 }
  }

  /** Outline the element briefly, so the user sees what the agent is about to click or type into. */
  private async flash(id: number): Promise<void> {
    const ok = await this.cmd('Overlay.highlightNode', { backendNodeId: id, highlightConfig: { contentColor: { r: 64, g: 140, b: 255, a: 0.25 }, borderColor: { r: 64, g: 140, b: 255, a: 0.9 } } }).then(() => true, () => false)
    if (!ok) return
    await sleep(350)
    await this.cmd('Overlay.hideHighlight').catch(() => {})
  }

  private async object(id: number): Promise<string> {
    const r = await this.cmd<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId: id, objectGroup: GROUP })
    return r.object.objectId
  }

  async snapshot(ref?: string): Promise<string> {
    const g = this.live()
    const { nodes } = await this.cmd<{ nodes: AXNode[] }>('Accessibility.getFullAXTree', {}, 20000)
    const s = formatSnapshot(nodes, this.refs, { rootBackendId: ref ? this.node(ref) : undefined, baseUrl: g.getURL() })
    return `Page: ${g.getTitle() || '(no title)'}\nURL: ${g.getURL()}\n${s.text}`
  }

  async click(ref: string): Promise<{ covered?: string }> {
    const p = await this.point(ref)
    await this.flash(p.id)
    // what is really under the centre: an overlay or modal would take the click instead
    const hit = await this.cmd<{ result: { value?: string } }>('Runtime.callFunctionOn', {
      objectId: await this.object(p.id), returnByValue: true, arguments: [{ value: p.x }, { value: p.y }],
      functionDeclaration: 'function(x,y){var e=document.elementFromPoint(x,y);if(!e||e===this||this.contains(e)||e.contains(this))return "";return e.tagName.toLowerCase()+(e.id?"#"+e.id:"")+(typeof e.className==="string"&&e.className?"."+e.className.trim().split(/\\s+/).slice(0,2).join("."):"")}'
    }).catch(() => null)
    const base = { x: p.x, y: p.y, button: 'left', clickCount: 1 }
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
    await this.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', buttons: 1, ...base })
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', buttons: 0, ...base })
    void this.cmd('Runtime.releaseObjectGroup', { objectGroup: GROUP }).catch(() => {})
    return { covered: hit?.result?.value || undefined }
  }

  async type(ref: string, text: string, submit: boolean): Promise<void> {
    const p = await this.point(ref)
    await this.flash(p.id)
    await this.cmd('DOM.focus', { backendNodeId: p.id }).catch(() => {
      throw new Error(`Element ${ref} cannot take keyboard focus; type into an input, textarea or editable element.`)
    })
    // select the current content, so the new text replaces it
    await this.cmd('Runtime.callFunctionOn', {
      objectId: await this.object(p.id),
      functionDeclaration: 'function(){if(typeof this.select==="function"){try{this.select();return}catch(e){}}var r=document.createRange();r.selectNodeContents(this);var s=getSelection();s.removeAllRanges();s.addRange(r)}'
    })
    void this.cmd('Runtime.releaseObjectGroup', { objectGroup: GROUP }).catch(() => {})
    if (text) await this.cmd('Input.insertText', { text })
    else await this.press('Delete')
    if (submit) await this.press('Enter')
  }

  async press(key: string): Promise<void> {
    const k = parseKeyCombo(key)
    if (!k) throw new Error(`Unknown key "${key}". Use names like Enter, Tab, Escape, ArrowDown, a, Control+A.`)
    const base = { modifiers: k.modifiers, key: k.key.key, code: k.key.code, windowsVirtualKeyCode: k.key.keyCode, nativeVirtualKeyCode: k.key.keyCode }
    await this.cmd('Input.dispatchKeyEvent', { type: k.key.text ? 'keyDown' : 'rawKeyDown', ...base, ...(k.key.text ? { text: k.key.text, unmodifiedText: k.key.text } : {}) })
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  async screenshot(): Promise<{ mediaType: string; data: string; width: number; height: number }> {
    const m = await this.cmd<{ cssVisualViewport?: { clientWidth: number; clientHeight: number } }>('Page.getLayoutMetrics').catch(() => ({ cssVisualViewport: undefined }))
    let r = await this.cmd<{ data: string }>('Page.captureScreenshot', { format: 'png' }, 20000)
    let mediaType = 'image/png'
    // large pages: JPEG keeps the conversation small
    if (r.data.length > 2_000_000) (r = await this.cmd('Page.captureScreenshot', { format: 'jpeg', quality: 70 }, 20000)), (mediaType = 'image/jpeg')
    return { mediaType, data: r.data, width: Math.round(m.cssVisualViewport?.clientWidth ?? 0), height: Math.round(m.cssVisualViewport?.clientHeight ?? 0) }
  }

  async wait(o: { text?: string; ref?: string; gone?: boolean; timeoutMs: number }, signal: AbortSignal): Promise<{ met: boolean; ms: number }> {
    const t0 = Date.now()
    const check = async (): Promise<boolean> => {
      if (o.text) {
        const r = await this.cmd<{ result: { value?: boolean } }>('Runtime.evaluate', { expression: `(document.body ? document.body.innerText : '').includes(${JSON.stringify(o.text)})`, returnByValue: true }, 3000)
        return !!r.result.value
      }
      return this.point(String(o.ref)).then(() => true, () => false)
    }
    while (!signal.aborted) {
      const there = await check().catch(() => false)
      if (there !== !!o.gone) return { met: true, ms: Date.now() - t0 }
      if (Date.now() - t0 >= o.timeoutMs) break
      await sleep(250)
    }
    return { met: false, ms: Date.now() - t0 }
  }

  async evaluate(expression: string): Promise<string> {
    const r = await this.cmd<{ result: { type: string; value?: unknown; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true, timeout: 10000 }, 15000)
    if (r.exceptionDetails) return `Exception: ${(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'error').slice(0, 4000)}`
    const v = r.result
    const out = v.type === 'undefined' ? 'undefined' : v.value !== undefined ? JSON.stringify(v.value, null, 2) : String(v.description ?? v.type)
    return out.length > 8000 ? `${out.slice(0, 8000)}\n[truncated]` : out
  }

  /**
   * Smoke and dev checks only (testIpc.ts): open or close the guest's DevTools, as the pane's bug button does.
   * detachFirst drops the debugger first, the way DevTools or a crash takes it away, to check that it comes back.
   */
  async testDevTools(open: boolean, detachFirst = false): Promise<{ open: boolean; attached: boolean; ms: number }> {
    const g = this.live()
    const t0 = Date.now()
    if (detachFirst && g.debugger.isAttached()) g.debugger.detach()
    if (open) g.openDevTools({ mode: 'detach' })
    else g.closeDevTools()
    for (const end = Date.now() + 60000; g.isDevToolsOpened() !== open && Date.now() < end; ) await sleep(100)
    const ms = Date.now() - t0
    await sleep(1500)
    return { open: g.isDevToolsOpened(), attached: g.debugger.isAttached(), ms }
  }

  consoleEntries(): { entries: ConsoleEntry[]; dropped: number } {
    return { entries: this.consoleLog.list(), dropped: this.consoleLog.dropped }
  }

  networkEntries(): NetEntry[] {
    return this.netLog.list()
  }
}
