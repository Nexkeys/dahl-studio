import os from 'node:os'
import type { PtyShells, ShellKind } from '@shared/types'
import { isValidPtyId } from '@shared/pty'
import { log, send } from '../services'
import { PtyManager } from './manager'
import { getShells, windowsBuild } from './shells'

export const ptys = new PtyManager((e) => send('pty:event', e), (msg) => void log('error', msg))

type Handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) => void

/** IPC for the terminal panel. Every terminal starts in an open project; shells come from the detected list only. */
export function registerPtyIpc(handle: Handle, assertProject: (p: string) => Promise<string>): void {
  handle('pty:shells', (): PtyShells => ({ shells: getShells(), buildNumber: process.platform === 'win32' ? windowsBuild(os.release()) : 0 }))
  handle('pty:create', async (id: string, project: string, shellId: ShellKind | null, cols: number, rows: number) => {
    if (!isValidPtyId(id)) throw new Error('Invalid terminal id.')
    const root = await assertProject(project)
    const shells = getShells()
    const shell = shells.find((s) => s.id === shellId) ?? shells[0]
    if (!shell) throw new Error('No shell found on this PC.')
    ptys.create(id, root, shell, cols, rows)
    return shell
  })
  handle('pty:write', (id: string, data: string) => ptys.write(id, data))
  handle('pty:resize', (id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  handle('pty:ack', (id: string, chars: number) => ptys.ack(id, chars))
  handle('pty:kill', (id: string) => ptys.kill(id))
  handle('pty:list', async (project: string) => ptys.list(await assertProject(project)))
  // a fresh renderer (first load or a reload) owns no terminals yet: end any left from before
  handle('pty:reset', () => ptys.killAll())
}
