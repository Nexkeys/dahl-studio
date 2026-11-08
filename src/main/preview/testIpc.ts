// Dev and smoke runs only: run a browser_* tool against the real Preview pane without a model, so the tools can be
// checked end to end. A smoke script calls window.dahl.invoke('preview:test', project, tool, args, mode?).
import { ipcMain } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Settings } from '@shared/types'
import { execTool, type ExecCtx } from '../agent/toolExec'
import { toolsFor } from '../agent/tools'
import type { BrowserBridge } from '../agent/browserTools'

/**
 * Goes through execTool with the lead's real tool list for the mode, so mode gating and argument repair apply.
 * Approvals are always declined here (browser_eval cannot run through this path). In a smoke run every result is
 * appended to <DAHL_SMOKE>/browser-tools.json and returned screenshots are saved next to it as PNG files.
 */
export function registerPreviewTestIpc(bridge: BrowserBridge & { testDevTools(open: boolean, detachFirst?: boolean): Promise<unknown> }, getSettings: () => Promise<Settings>, log: (msg: string) => void): void {
  const smoke = process.env.DAHL_SMOKE
  const results: unknown[] = []
  ipcMain.handle('preview:test', async (_e, project: string, tool: string, args: Record<string, unknown> = {}, mode: 'build' | 'plan' | 'review' = 'build') => {
    try {
      // the user opening or closing the Preview DevTools, which takes the debugger away from the agent
      if (tool === 'devtools') {
        const r = { tool, args, ...((await bridge.testDevTools(!!args.open, !!args.detachFirst)) as object) }
        log(`preview:test devtools ${JSON.stringify(r)}`)
        results.push(r)
        return { ok: true, value: r }
      }
      const s = await getSettings()
      if (!s.openProjects.some((p) => path.resolve(p).toLowerCase() === path.resolve(String(project)).toLowerCase())) throw new Error('Project is not open in Dahl Studio.')
      if (!/^browser_/.test(String(tool))) throw new Error('preview:test only runs browser_* tools.')
      const c = {
        run: { id: 'preview-test', project, mode, model: 'test', commandsRun: [] },
        deps: { browser: bridge, getSettings, secrets: async () => [], modelVision: async () => true },
        signal: new AbortController().signal, agentId: 'lead', agentName: 'Dahl', ownedFiles: [], leases: new Map(), images: new Map(), mcpTools: [],
        turn: { changed: new Set(), commands: [], memories: 0 },
        approve: async () => ({ approved: false, feedback: 'Approvals are declined in the test path.' }),
        emitPlan: () => {}, onChanged: () => {}, status: () => {}
      } as unknown as ExecCtx
      const t0 = Date.now()
      log(`preview:test ${tool} started`)
      const r = await execTool(c, String(tool), JSON.stringify(args ?? {}), toolsFor('lead', mode, false))
      const out = { tool, args, mode, ok: r.ok, ms: Date.now() - t0, text: r.text, images: (r.images ?? []).map((i) => i.name) }
      log(`preview:test ${tool} ${r.ok ? 'ok' : 'failed'} in ${out.ms} ms`)
      if (smoke) {
        for (const im of r.images ?? []) await fs.writeFile(path.join(smoke, `browser-${im.name.replace(/[^\w.-]/g, '_')}`), Buffer.from(im.data, 'base64'))
        results.push(out)
        await fs.writeFile(path.join(smoke, 'browser-tools.json'), JSON.stringify(results, null, 2))
      }
      return { ok: true, value: out }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}
