// Console and network history of the page in the Preview pane: bounded ring buffers plus the text the agent reads.

/** Fixed-size buffer: pushing past capacity drops the oldest entry. */
export class RingBuffer<T> {
  private items: (T | undefined)[]
  private start = 0
  private count = 0
  /** entries dropped because the buffer was full (since the last clear) */
  dropped = 0
  constructor(readonly capacity: number) {
    this.items = new Array(Math.max(1, capacity))
  }
  push(item: T): void {
    const cap = this.items.length
    if (this.count < cap) this.items[(this.start + this.count++) % cap] = item
    else {
      this.items[this.start] = item
      this.start = (this.start + 1) % cap
      this.dropped++
    }
  }
  /** Oldest first. */
  list(): T[] {
    const out: T[] = []
    for (let i = 0; i < this.count; i++) out.push(this.items[(this.start + i) % this.items.length] as T)
    return out
  }
  clear(): void {
    this.items = new Array(this.items.length)
    this.start = this.count = this.dropped = 0
  }
  get size(): number {
    return this.count
  }
}

export type ConsoleLevel = 'error' | 'warning' | 'info' | 'debug'
export interface ConsoleEntry {
  at: number
  level: ConsoleLevel
  text: string
  /** script URL and line, when the page reported them */
  source?: string
  line?: number
}

export interface NetEntry {
  at: number
  method: string
  url: string
  /** Document, Script, XHR, Fetch, Stylesheet, Image... */
  type?: string
  status?: number
  statusText?: string
  /** net::ERR_... text when the request failed (blocked, refused, aborted) */
  error?: string
}

/** Electron reports console levels as names ('warning') or, in older events, numbers (0 debug .. 3 error). */
export function consoleLevel(raw: unknown): ConsoleLevel {
  if (raw === 3 || raw === 'error') return 'error'
  if (raw === 2 || raw === 'warning' || raw === 'warn') return 'warning'
  if (raw === 0 || raw === 'debug' || raw === 'verbose') return 'debug'
  return 'info'
}

export const isProblem = (n: NetEntry): boolean => !!n.error || (n.status ?? 0) >= 400

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}...` : s)
const ago = (at: number, now: number): string => `${Math.max(0, Math.round((now - at) / 1000))}s ago`

/** Errors and warnings by default; `all` adds info and debug. Newest last, at most `max` entries. */
export function formatConsole(entries: ConsoleEntry[], o: { all?: boolean; max?: number; now?: number; dropped?: number } = {}): string {
  const now = o.now ?? Date.now()
  const pick = entries.filter((e) => o.all || e.level === 'error' || e.level === 'warning')
  const errors = entries.filter((e) => e.level === 'error').length
  const warnings = entries.filter((e) => e.level === 'warning').length
  const head = `Console since the page loaded: ${errors} error(s), ${warnings} warning(s), ${entries.length} message(s) in total.`
  if (!pick.length) return o.all || !entries.length ? `${head}${entries.length ? '' : ' Nothing was logged.'}` : `${head} No errors or warnings.`
  const max = o.max ?? 40
  const shown = pick.slice(-max)
  const lines = shown.map((e) => `[${e.level}] ${clip(e.text.replace(/\s+$/, ''), 1200)}${e.source ? `\n    at ${clip(e.source, 160)}${e.line ? `:${e.line}` : ''}` : ''} (${ago(e.at, now)})`)
  const more = pick.length - shown.length + (o.dropped ?? 0)
  return [head, ...lines, more > 0 ? `(${more} older message(s) not shown)` : ''].filter(Boolean).join('\n')
}

/** Failed requests and HTTP 4xx/5xx by default; `all` lists every recent request. */
export function formatNetwork(entries: NetEntry[], o: { all?: boolean; max?: number; now?: number } = {}): string {
  const now = o.now ?? Date.now()
  const bad = entries.filter(isProblem)
  const pick = o.all ? entries : bad
  const head = `Network since the page loaded: ${entries.length} request(s), ${bad.length} failed or 4xx/5xx.`
  if (!pick.length) return entries.length ? `${head} No failed requests.` : `${head} No requests recorded yet.`
  const max = o.max ?? 40
  const shown = pick.slice(-max)
  const lines = shown.map((n) => {
    const result = n.error ? `FAILED ${n.error}` : n.status ? `${n.status}${n.statusText ? ` ${n.statusText}` : ''}` : 'pending'
    return `${result}  ${n.method} ${clip(n.url, 300)}${n.type ? ` [${n.type}]` : ''} (${ago(n.at, now)})`
  })
  return [head, ...lines, pick.length > shown.length ? `(${pick.length - shown.length} older request(s) not shown)` : ''].filter(Boolean).join('\n')
}
