import type { PanelImperativeHandle } from 'react-resizable-panels'
import { useStore } from './store'

// Workspace layout shortcuts: Ctrl+B explorer, Ctrl+Alt+B chat, Ctrl+J or Ctrl+` terminal.

// editor: collapsed by the terminal's maximise button
export const panels: { explorer: PanelImperativeHandle | null; chat: PanelImperativeHandle | null; editor: PanelImperativeHandle | null } = { explorer: null, chat: null, editor: null }

export function togglePanel(name: keyof typeof panels): void {
  const p = panels[name]
  if (!p) return
  if (p.isCollapsed()) p.expand()
  else p.collapse()
}

export function toggleTerminal(): void {
  const st = useStore.getState()
  st.set({ showTerminal: !st.showTerminal })
}

/** Window keydown (capture phase). Only acts in the workspace view. */
export function onLayoutKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || useStore.getState().view !== 'workspace') return
  const k = e.key.toLowerCase()
  const act = k === 'b' ? () => togglePanel(e.altKey ? 'chat' : 'explorer') : !e.altKey && (k === 'j' || e.code === 'Backquote') ? toggleTerminal : null
  if (!act) return
  e.preventDefault()
  e.stopPropagation()
  act()
}
