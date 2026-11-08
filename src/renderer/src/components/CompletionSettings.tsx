import { Sparkles } from 'lucide-react'
import type { ProviderId } from '@shared/types'
import { isFastCompletionModel } from '@shared/completion'
import { PROVIDER_NAMES, updateSettings, useStore } from '../store'
import '../ui-completion.css'

const providerName = (p: string) => PROVIDER_NAMES[p as ProviderId] ?? p

/** Settings > Tab completions: on/off and the completion model (any configured provider's model). */
export function CompletionSettings() {
  const s = useStore((st) => st.settings)
  const models = useStore((st) => st.models)
  if (!s) return null
  const model = s.completionModel ?? ''
  const fast = models.filter((m) => isFastCompletionModel(m.key))
  const providers = [...new Set(models.map((m) => m.provider))]
  const known = !model || models.some((m) => m.key === model)
  const pick = (key: string) =>
    // choosing the first model turns completions on; after that the switch is the user's
    void updateSettings({ completionModel: key || null, ...(key && s.tabCompletions === undefined ? { tabCompletions: true } : {}) })
  return (
    <section>
      <h2><Sparkles size={16} /> Tab completions</h2>
      <p className="muted small">
        Grey suggestions appear in the editor when you pause typing. Tab accepts all of it, Ctrl+Right accepts the next word, Esc dismisses, Alt+\ asks again.
        Each suggestion is one short request to the model chosen here, with about 1,000 tokens of the file around the cursor. Nothing is sent while this is off or no model is chosen.
      </p>
      <label className="check">
        <input type="checkbox" checked={!!s.tabCompletions && !!model} disabled={!model} onChange={(e) => updateSettings({ tabCompletions: e.target.checked })} />
        Show Tab completions in the editor{model ? '' : ' (choose a completion model first)'}
      </label>
      <label className="check tabc-model">Completion model
        <select className="input small" value={model} onChange={(e) => pick(e.target.value)} aria-label="Completion model">
          <option value="">None (off)</option>
          {!known && <option value={model}>{model}</option>}
          {fast.length > 0 && (
            <optgroup label="Suggested: fast models">
              {fast.map((m) => <option key={`fast-${m.key}`} value={m.key}>{providerName(m.provider)}: {m.label}</option>)}
            </optgroup>
          )}
          {providers.map((p) => (
            <optgroup key={p} label={providerName(p)}>
              {models.filter((m) => m.provider === p).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="muted small">
        Pick a fast, cheap model: a Groq model, or a local Ollama coder model such as qwen2.5-coder (free and private).
        Coder models served by Ollama or LM Studio, and Codestral, fill in the middle natively; other chat models are asked to fill the gap at the cursor.
      </p>
    </section>
  )
}
