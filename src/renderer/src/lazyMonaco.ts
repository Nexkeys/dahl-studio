import { lazy } from 'react'

// Monaco is most of the renderer's JavaScript. It loads the first time an editor or diff is shown, or when the
// app is idle after startup (preloadMonaco), so the window paints without parsing it first.
const load = () => import('./monaco')

export const Editor = lazy(() => load().then((m) => ({ default: m.Editor })))
export const DiffEditor = lazy(() => load().then((m) => ({ default: m.DiffEditor })))

export function preloadMonaco(): void {
  void load().catch(() => 0)
}
