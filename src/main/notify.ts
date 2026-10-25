import { app, Notification } from 'electron'
import path from 'node:path'
import type { AgentEvent } from '@shared/types'
import { send, settings, win } from './services'

/**
 * Windows notifications so the user knows when Dahl needs them: approval requests, finished, failed or paused
 * tasks and failed sub-agents. Shown only when the window is not focused (the taskbar icon also flashes).
 * Clicking a notification focuses the window and switches to that project.
 */
const iconPath = (): string => path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources'), 'icon.png')
const recent = new Map<string, number>()

/** Settings > "Send test notification": always shows, so users can confirm Windows allows them. */
export function testNotification(): boolean {
  if (!Notification.isSupported()) return false
  new Notification({ title: 'Dahl Studio notifications are on', body: 'You will be notified about approvals, finished, failed and paused tasks while Dahl Studio is in the background.', icon: iconPath() }).show()
  return true
}

export async function notifyAgentEvent(e: AgentEvent): Promise<void> {
  const w = win.current
  if (!w || w.isDestroyed() || w.isFocused()) return
  const s = await settings.get()
  if (!s.notifications || !Notification.isSupported()) return
  const project = path.basename(e.project)
  let title = ''
  let body = ''
  if (e.type === 'approval' && e.approval) {
    const a = e.approval
    title = `Approval needed in ${project}`
    body = a.kind === 'write' ? `${a.agent && a.agent !== 'Dahl' ? `${a.agent} wants` : 'Dahl wants'} to change ${a.path}` : a.kind === 'command' ? `Run command: ${a.command}` : `Use connector tool ${a.tool}`
  } else if (e.type === 'status' && e.status) {
    if (e.status === 'completed') (title = `Dahl finished in ${project}`), (body = 'The task is complete. Review the result and summary.')
    else if (e.status === 'failed') (title = `Dahl hit an error in ${project}`), (body = 'The task stopped with an error. Open Dahl Studio to see it and Continue.')
    else if (e.status === 'paused') (title = `Dahl paused in ${project}`), (body = 'Step limit reached or paused. Send "Continue" to keep going.')
  } else if (e.type === 'agent' && e.agent?.status === 'failed') {
    title = `${e.agent.name} agent failed in ${project}`
    body = e.agent.step.slice(0, 180)
  }
  if (!title) return
  const key = `${e.runId}:${title}`
  if (Date.now() - (recent.get(key) ?? 0) < 4000) return // de-duplicate bursts
  recent.set(key, Date.now())
  const n = new Notification({ title, body: body.slice(0, 240), icon: iconPath(), silent: false })
  n.on('click', () => {
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
    send('app:focusProject', e.project)
  })
  n.show()
  w.flashFrame(true)
  w.once('focus', () => w.flashFrame(false))
}
