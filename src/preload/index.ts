import { contextBridge, ipcRenderer } from 'electron'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function on(channel: string, cb: (payload: any) => void): () => void {
  const fn = (_e: unknown, p: unknown): void => cb(p)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

const ALLOWED_EVENTS = new Set(['agent:event', 'term:event', 'keys:changed', 'usage:changed', 'models:changed', 'mcp:changed', 'update:status'])

/** The only surface the renderer gets. No Node, no raw ipcRenderer, no secrets returned. */
const api = {
  invoke: <T>(channel: string, ...args: unknown[]) => call<T>(channel, ...args),
  on: (channel: string, cb: (payload: any) => void) => {
    if (!ALLOWED_EVENTS.has(channel)) throw new Error(`Event not allowed: ${channel}`)
    return on(channel, cb)
  }
}

contextBridge.exposeInMainWorld('dahl', api)
