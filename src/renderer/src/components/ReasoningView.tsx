import { useEffect, useState } from 'react'
import { BrainCircuit, Check, Copy, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import type { ReasoningProfile, ReasoningState, Settings } from '@shared/types'
import { api, baseName, useStore } from '../store'

/** Reasoning panel: the reasoning framework every task follows. Editable; one profile can be chosen per project. */
export function ReasoningView() {
  const settings = useStore((s) => s.settings)
  const root = settings?.activeProject ?? null
  const [st, setSt] = useState<ReasoningState | null>(null)
  const [sel, setSel] = useState('default')
  const [draft, setDraft] = useState<ReasoningProfile | null>(null)
  const { notify, set } = useStore.getState()

  useEffect(() => void api.invoke<ReasoningState>('reasoning:get').then((s) => (setSt(s), setSel(s.activeId))), [])
  useEffect(() => {
    if (sel === '__new') return // keep the unsaved draft for a new profile
    const p = st?.profiles.find((x) => x.id === sel)
    setDraft(p ? { ...p } : null)
  }, [sel, st])
  if (!st || !draft) return <div className="view"><h1>Reasoning</h1></div>

  const orig = st.profiles.find((p) => p.id === draft.id)
  const dirty = !orig || orig.prompt !== draft.prompt || orig.name !== draft.name || orig.description !== draft.description
  const override = root ? settings?.projectReasoning[root] : undefined
  const effective = override ?? st.activeId
  const run = async (ch: string, ...a: unknown[]) => {
    try {
      const s = await api.invoke<ReasoningState>(ch, ...a)
      setSt(s)
      return s
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const save = async () => {
    const s = await run('reasoning:save', draft)
    if (s && !draft.id) setSel(s.profiles[s.profiles.length - 1].id)
    notify('Reasoning profile saved')
  }
  const setProject = async (id: string | null) => {
    if (!root) return
    set({ settings: await api.invoke<Settings>('reasoning:projectOverride', root, id) })
  }

  return (
    <div className="view wide">
      <h1><BrainCircuit size={20} /> Reasoning</h1>
      <p className="muted small">The active profile is injected into every request and sub-agent, so Dahl plans, codes and reviews according to it. Edit the default or switch to a preset, such as the Cybersecurity Analyst that attacks your own code.</p>
      <div className="reason-layout">
        <div className="reason-list">
          {st.profiles.map((p) => (
            <button key={p.id} className={`reason-item ${sel === p.id ? 'on' : ''}`} onClick={() => setSel(p.id)}>
              <div className="reason-name">{p.name}{effective === p.id && <span className="pill ok">In use</span>}</div>
              <div className="muted small">{p.description}</div>
            </button>
          ))}
          <button className="btn ghost small" onClick={() => { setSel('__new'); setDraft({ id: '', name: 'My reasoning', description: 'Custom', prompt: st.profiles[0].prompt, builtin: false }) }}><Plus size={13} /> New profile</button>
        </div>
        <div className="reason-editor">
          <input className="input title-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Profile name" />
          <input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Short description" aria-label="Description" />
          <textarea className="reason-text" value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} spellCheck={false} aria-label="Reasoning prompt" />
          <div className="row">
            <button className="btn primary" onClick={save} disabled={!dirty}><Save size={14} /> Save</button>
            <button className="btn ghost" disabled={!draft.id} onClick={() => run('reasoning:activate', draft.id)}><Check size={14} /> Use globally</button>
            {root && <button className="btn ghost" disabled={!draft.id} onClick={() => setProject(override === draft.id ? null : draft.id)}>{override === draft.id ? 'Stop using for ' : 'Use only for '}{baseName(root)}</button>}
            <span className="grow" />
            <button className="icon-btn" title="Duplicate" aria-label="Duplicate" onClick={() => { setSel('__new'); setDraft({ ...draft, id: '', name: `${draft.name} copy`, builtin: false }) }}><Copy size={14} /></button>
            {draft.builtin ? <button className="icon-btn" title="Reset to default text" aria-label="Reset" onClick={() => run('reasoning:reset', draft.id)}><RotateCcw size={14} /></button>
              : draft.id && <button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => window.confirm('Delete this profile?') && run('reasoning:remove', draft.id).then(() => setSel('default'))}><Trash2 size={14} /></button>}
          </div>
          <div className="muted small">Global: <b>{st.profiles.find((p) => p.id === st.activeId)?.name}</b>{override && root ? <> · {baseName(root)} uses <b>{st.profiles.find((p) => p.id === override)?.name}</b></> : null}</div>
        </div>
      </div>
    </div>
  )
}
