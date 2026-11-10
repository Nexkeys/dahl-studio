import { Gauge } from 'lucide-react'
import type { QualityPreset } from '@shared/types'
import { PRESET_THINKING } from '@shared/cost'
import { updateSettings, useStore } from '../store'
import '../ui-cost.css'

const PRESETS: { id: QualityPreset; label: string; hint: string }[] = [
  { id: 'economy', label: 'Economy', hint: 'Economy: light thinking, uses the cheaper models set per role in Settings > Usage, at most 2 helper agents at once, only the newest 2 images per request and no paid image description' },
  { id: 'balanced', label: 'Balanced', hint: 'Balanced: medium thinking, uses the models set per role in Settings > Usage, up to 6 helper agents' },
  { id: 'best', label: 'Best', hint: 'Best: deep thinking, every agent runs on the main model (role models for helpers, research and review are ignored)' }
]

/** Quality preset beside the thinking select. Picking one also sets the thinking level, which can still be changed. */
export function PresetSwitch() {
  const preset = useStore((s) => s.settings?.qualityPreset ?? 'balanced')
  const cur = PRESETS.find((p) => p.id === preset) ?? PRESETS[1]
  return (
    <label className="think preset" title={cur.hint}>
      <Gauge size={13} />
      <select value={preset} aria-label="Quality preset" onChange={(e) => {
        const id = e.target.value as QualityPreset
        void updateSettings({ qualityPreset: id, thinking: PRESET_THINKING[id] })
      }}>
        {PRESETS.map((p) => <option key={p.id} value={p.id} title={p.hint}>{p.label}</option>)}
      </select>
    </label>
  )
}
