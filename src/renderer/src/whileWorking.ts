import { useEffect, useRef } from 'react'
import type { RunStatus, StartRunRequest, TranscriptItem } from '@shared/types'
import { joinOut, seenSteers, settleOut, type OutMsg, type SendHow } from '@shared/outbox'
import { api, useStore } from './store'
import { addOut, markSteered, removeOut, setOut, useOutbox } from './outbox'

type Send = (text: string, mcpServers?: StartRunRequest['mcpServers']) => Promise<void> | void
interface RunView { runId: string | null; status: RunStatus | null; transcript: TranscriptItem[]; attachments: unknown[] }

/**
 * Sending while Dahl works, the way Claude Code does it. Enter hands the message to the running task, which reads it
 * at its next step; Alt+Enter keeps it until the task finishes; Ctrl+Enter stops the task and sends it straight away.
 * Messages with attachments or a connector focus need a new turn, so they always wait for the task to finish.
 */
export function useWhileWorking(root: string, v: RunView, running: boolean, send: Send) {
  const sendRef = useRef(send)
  sendRef.current = send
  const view = useRef(v)
  view.current = v
  const prev = useRef({ running, runId: v.runId })

  // when the task stops: drop what it read, and send what is waiting (see settleOut for when)
  useEffect(() => {
    const was = prev.current
    prev.current = { running, runId: v.runId }
    if (!was.running || running || !was.runId || was.runId !== v.runId) return
    const { items, send: out } = settleOut(useOutbox.getState().items, was.runId, seenSteers(view.current.transcript), v.status)
    setOut(items)
    if (out.length) {
      const j = joinOut(out)
      void sendRef.current(j.text, j.mcpServers)
    }
  }, [running, v.runId, v.status])

  const plain = (mcp?: StartRunRequest['mcpServers']) => !mcp && !view.current.attachments.length
  const steer = (id: string, text: string) => api.invoke<boolean>('agent:steer', root, id, text).catch(() => false)

  const submit = async (text: string, mcpServers?: StartRunRequest['mcpServers'], how?: SendHow): Promise<void> => {
    const runId = view.current.runId
    if (!running || !runId) return void (await send(text, mcpServers))
    const id = crypto.randomUUID()
    if ((how ?? 'steer') === 'steer' && plain(mcpServers) && (await steer(id, text))) return addOut({ id, runId, text, kind: 'steer' })
    addOut({ id, runId, text, kind: 'queued', urgent: how === 'stop', mcpServers })
    if (how === 'stop') await api.invoke('agent:cancel', root).catch(() => {})
    else if (!plain(mcpServers)) useStore.getState().notify('Messages with attachments or a connector go out when this task finishes.')
  }

  const sendNow = async (m: OutMsg): Promise<void> => {
    if (running) {
      if (plain(m.mcpServers) && (await steer(m.id, m.text))) return markSteered(m.id)
      return useStore.getState().notify('Dahl will read this when the current task finishes.')
    }
    removeOut(m.id)
    await send(m.text, m.mcpServers)
  }

  return { submit, sendNow }
}
