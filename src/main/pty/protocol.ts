// Messages between the main process and the PTY host (utilityProcess). Types only.

export type HostIn =
  | { t: 'create'; id: string; file: string; args: string[]; cwd: string; cols: number; rows: number; env: Record<string, string> }
  | { t: 'write'; id: string; data: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'ack'; id: string; chars: number }
  | { t: 'kill'; id: string }
  | { t: 'killAll' }

export type HostOut =
  | { t: 'ready' }
  | { t: 'created'; id: string; pid: number }
  | { t: 'data'; id: string; data: string }
  | { t: 'exit'; id: string; code: number | null }
