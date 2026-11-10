import { Sparkles } from 'lucide-react'
import { updateSettings, useStore } from '../store'
import { setCompletionActivity, useCompletion } from '../completion/state'
import '../ui-completion.css'

const LABEL = { off: 'Tab: off', on: 'Tab: on', thinking: 'Tab: thinking', error: 'Tab: error' }

/** Status bar indicator for Tab completions (off, on, thinking, error). Click toggles them. */
export function CompletionStatus() {
  const on = useStore((s) => !!s.settings?.tabCompletions)
  const model = useStore((s) => s.settings?.completionModel ?? null)
  const label = useStore((s) => s.models.find((m) => m.key === s.settings?.completionModel)?.label ?? null)
  const activity = useCompletion((s) => s.activity)
  const error = useCompletion((s) => s.error)
  const state = !on || !model ? 'off' : activity === 'idle' ? 'on' : activity
  const name = label ?? model
  const title =
    state === 'off' ? (model ? `Tab completions are off. Click to turn them on (${name}).` : 'Tab completions: choose a completion model in Settings first.')
      : state === 'error' ? `Tab completions (${name}): ${error ?? 'the last request failed'}. Click to turn them off.`
        : `Tab completions with ${name}. Tab accepts, Ctrl+Right accepts a word, Esc dismisses. Click to turn them off.`
  const toggle = () => {
    const st = useStore.getState()
    if (!model) {
      st.set({ view: 'settings' })
      st.notify('Choose a completion model under Settings > Tab completions first.')
      return
    }
    setCompletionActivity('idle')
    void updateSettings({ tabCompletions: !on })
  }
  return (
    <button className={`sb-btn sb-item tabc ${state}`} onClick={toggle} title={title} aria-pressed={state !== 'off'}>
      <Sparkles size={12} /> {LABEL[state]}
    </button>
  )
}
