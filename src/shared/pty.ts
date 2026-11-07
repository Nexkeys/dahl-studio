// Pure parts of the integrated terminal, shared by the PTY host (main side) and the xterm.js panel (renderer).

/** Pause the shell when this many characters were sent but not yet drawn by xterm.js. */
export const HIGH_WATERMARK = 100_000
/** Resume it once the unacknowledged backlog drops below this. */
export const LOW_WATERMARK = 10_000
/** The renderer acknowledges drawn output in batches of this size (must stay below LOW_WATERMARK). */
export const ACK_BATCH = 5_000

/**
 * Flow control for one PTY (host side). xterm.js parses far slower than a shell can print (`cat` of a big file,
 * a noisy build), so the host pauses the PTY while too much output is in flight and resumes it on ACKs.
 */
export class FlowControl {
  private unacked = 0
  private paused = false

  constructor(private readonly high = HIGH_WATERMARK, private readonly low = LOW_WATERMARK) {}

  /** Record output sent to the renderer. True when the PTY should be paused now. */
  sent(chars: number): boolean {
    this.unacked += chars
    if (!this.paused && this.unacked > this.high) return (this.paused = true)
    return false
  }

  /** Record output the renderer has drawn. True when the PTY should be resumed now. */
  acked(chars: number): boolean {
    this.unacked = Math.max(0, this.unacked - Math.max(0, chars))
    if (this.paused && this.unacked < this.low) {
      this.paused = false
      return true
    }
    return false
  }

  get backlog(): number {
    return this.unacked
  }

  get isPaused(): boolean {
    return this.paused
  }
}

/** Renderer side: count drawn characters and report them in ACK_BATCH sized steps. */
export class AckBatcher {
  private pending = 0

  constructor(private readonly send: (chars: number) => void, private readonly batch = ACK_BATCH) {}

  drawn(chars: number): void {
    this.pending += chars
    if (this.pending >= this.batch) {
      const n = this.pending
      this.pending = 0
      this.send(n)
    }
  }
}

/** Shell integration marks (OSC 633, the sequence VS Code uses), emitted by our PowerShell prompt wrapper. */
export type ShellMark =
  | { kind: 'prompt-start' }
  | { kind: 'prompt-end' }
  | { kind: 'command-line'; command: string }
  | { kind: 'executed' }
  | { kind: 'finished'; code: number | null }

/** Undo the PowerShell side's escaping: `\xHH` byte sequences (UTF-8) back to text. */
export function unescapeMarkValue(v: string): string {
  const bytes: number[] = []
  let out = ''
  const flush = (): void => {
    if (bytes.length) out += new TextDecoder().decode(new Uint8Array(bytes.splice(0)))
  }
  for (let i = 0; i < v.length; i++) {
    const m = /^\\x([0-9a-fA-F]{2})/.exec(v.slice(i, i + 4))
    if (m) {
      bytes.push(parseInt(m[1], 16))
      i += 3
    } else {
      flush()
      out += v[i]
    }
  }
  flush()
  return out
}

/** Parse the payload of an OSC 633 sequence (the part after "633;"). Unknown marks return null. */
export function parseShellMark(payload: string): ShellMark | null {
  const [kind, ...rest] = payload.split(';')
  switch (kind) {
    case 'A': return { kind: 'prompt-start' }
    case 'B': return { kind: 'prompt-end' }
    case 'C': return { kind: 'executed' }
    case 'E': return { kind: 'command-line', command: unescapeMarkValue(rest[0] ?? '') }
    case 'D': {
      const n = rest.length && rest[0] !== '' ? Number(rest[0]) : NaN
      return { kind: 'finished', code: Number.isFinite(n) ? n : null }
    }
    default: return null
  }
}

/** A terminal id from the renderer: short and plain, since it ends up in IPC routing and logs. */
export function isValidPtyId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

/** Clamp terminal dimensions to something a PTY accepts. */
export function clampDims(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const c = Math.floor(Number(cols))
  const r = Math.floor(Number(rows))
  return { cols: Number.isFinite(c) ? Math.min(Math.max(c, 2), 1000) : 80, rows: Number.isFinite(r) ? Math.min(Math.max(r, 1), 500) : 24 }
}
