import { create } from 'zustand'
import type { OutMsg } from '@shared/outbox'

/** Messages typed while a task runs (see shared/outbox.ts). Kept outside the project store: they are not saved. */
export const useOutbox = create<{ items: OutMsg[] }>(() => ({ items: [] }))

export function addOut(m: OutMsg): void {
  useOutbox.setState((s) => ({ items: [...s.items, m] }))
}

export function removeOut(id: string): void {
  useOutbox.setState((s) => ({ items: s.items.filter((m) => m.id !== id) }))
}

export function setOut(items: OutMsg[]): void {
  useOutbox.setState({ items })
}

export function markSteered(id: string): void {
  useOutbox.setState((s) => ({ items: s.items.map((m) => (m.id === id ? { ...m, kind: 'steer' as const } : m)) }))
}
