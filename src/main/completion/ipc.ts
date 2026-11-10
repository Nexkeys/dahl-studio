import { app, ipcMain, type InputEvent } from 'electron'
import type { CompletionRequest, CompletionResponse } from '@shared/types'
import { log, models, settings, vault, win } from '../services'
import { PROVIDER_INFO } from '../providers/registry'
import { redact } from '../util'
import { CompletionService } from './service'
import type { Endpoint } from './transport'

/** Local servers that may not be in the provider list yet (their default OpenAI-compatible addresses). */
const LOCAL_BASES: Record<string, string> = {
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  mistral: 'https://api.mistral.ai/v1'
}

async function endpoint(provider: string): Promise<Endpoint> {
  const info = (PROVIDER_INFO as Record<string, { base: string; slot: string } | undefined>)[provider]
  const base = info?.base ?? LOCAL_BASES[provider]
  if (!base) throw new Error(`No completion endpoint is known for the provider "${provider}".`)
  return { base, key: await vault.get(info?.slot ?? provider).catch(() => null) }
}

export const completions = new CompletionService({
  getSettings: () => settings.get(),
  chat: (req, signal) => models.chat({ ...req, thinking: 'off' }, signal),
  endpoint,
  // "fake:" completion models exist for smoke runs and npm run dev only, never in the installed app
  allowFake: !!process.env.DAHL_SMOKE || !app.isPackaged
})

let lastLogged = ''

/** completion:request and completion:cancel (and smoke:input in smoke runs). Same { ok, value } shape as ipc.ts. */
export function registerCompletionIpc(): void {
  const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return { ok: true, value: await fn(...args) }
      } catch (e) {
        return { ok: false, error: redact((e as Error)?.message ?? String(e), await vault.allValues().catch(() => [])) }
      }
    })
  }
  handle('completion:request', async (req: CompletionRequest): Promise<CompletionResponse> => {
    const r = await completions.request(req)
    if (r.error) {
      r.error = redact(r.error, await vault.allValues().catch(() => []))
      // one log line per distinct error, not one per keystroke
      if (r.error !== lastLogged && !r.skipped) void log('error', `tab completion: ${r.error}`)
      lastLogged = r.error
    }
    return r
  })
  handle('completion:cancel', (id: number) => completions.cancel(id))

  // Smoke runs only: real keyboard and mouse input (Chromium-level, like a user), so a smoke script can type in the
  // editor and press Tab. Synthetic DOM events do not reach Monaco's EditContext input.
  if (process.env.DAHL_SMOKE) {
    handle('smoke:input', async (events: InputEvent[]) => {
      const wc = win.current?.webContents
      if (!wc) return false
      wc.focus()
      for (const e of events) {
        wc.sendInputEvent(e as Parameters<typeof wc.sendInputEvent>[0])
        await new Promise((r) => setTimeout(r, 12))
      }
      return true
    })
  }
}
