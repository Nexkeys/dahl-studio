export interface DahlBridge {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  on(channel: 'agent:event' | 'term:event' | 'keys:changed' | 'usage:changed' | 'models:changed' | 'mcp:changed' | 'update:status', cb: (payload: any) => void): () => void
}

declare global {
  interface Window {
    dahl: DahlBridge
  }
}
