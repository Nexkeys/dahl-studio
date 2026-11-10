import { create } from 'zustand'

// Live state of Tab completions for the status bar indicator. Kept out of the main store: it changes on every pause
// in typing, and only the indicator cares.

export type CompletionActivity = 'idle' | 'thinking' | 'error'

interface CompletionState {
  activity: CompletionActivity
  error: string | null
}

export const useCompletion = create<CompletionState>(() => ({ activity: 'idle', error: null }))

export function setCompletionActivity(activity: CompletionActivity, error: string | null = null): void {
  const cur = useCompletion.getState()
  if (cur.activity !== activity || cur.error !== error) useCompletion.setState({ activity, error })
}
