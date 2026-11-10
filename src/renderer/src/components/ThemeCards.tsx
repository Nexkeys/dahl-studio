import type { CSSProperties } from 'react'
import { Check, GitBranch, LayoutPanelLeft, LoaderCircle, Users } from 'lucide-react'
import type { ThemeId } from '@shared/types'
import { updateSettings } from '../store'
import { THEMES, applyTheme, type Theme } from '../themes'

const GROUPS: { id: Theme['group']; label: string; note: string }[] = [
  { id: 'light', label: 'Light', note: 'Paper-bright themes for daylight.' },
  { id: 'dark', label: 'Dark', note: 'Low-glare themes for long sessions.' },
  { id: 'contrast', label: 'High contrast', note: 'Every line and label at 7:1 or more, with thick focus rings.' }
]

const DENSITY_WORD = { compact: 'Compact', regular: 'Regular', roomy: 'Roomy' }
const SURFACE_WORD = { flat: 'Flat', elevated: 'Layered', islands: 'Islands', bordered: 'Outlined', glass: 'Glass' }

/**
 * A miniature of the theme's own window: top bar with tabs, rail, a line of code, a chat bubble and a button. The
 * theme's variables and structure attributes are scoped to the card, so it shows surfaces, corners, type, icon
 * weight and accent use, not just colours.
 */
export function ThemePreview({ t, on, onPick }: { t: Theme; on: boolean; onPick: () => void }) {
  const d = t.data
  const short = t.tagline.split(/[,.]/)[0].toLowerCase()
  return (
    <button className={`theme-card ${on ? 'on' : ''}`} onClick={onPick} aria-pressed={on} aria-label={`${t.name}: ${t.tagline}`}>
      <div className="tp" style={t.vars as CSSProperties} data-surface={d.surface} data-sep={d.sep} data-density={d.density} data-labels={d.labels} data-chrome={d.chrome} data-effect={d.effect}>
        <div className="tp-top">
          <span className="tp-tab on">app.ts</span><span className="tp-tab">cart.ts</span>
        </div>
        <div className="tp-body">
          <div className="tp-rail">
            <span className="on"><LayoutPanelLeft size={11} /></span><span><GitBranch size={11} /></span><span><Users size={11} /></span>
          </div>
          <div className="tp-editor">
            <div><b className="k">const</b> total <i>=</i> <b className="f">sum</b><i>(</i><b className="s">'cart'</b><i>)</i></div>
            <div className="hl"><b className="c">// {short}</b></div>
            <div><b className="k">return</b> <b className="n">42</b></div>
          </div>
          <div className="tp-chat">
            <span className="tp-st"><LoaderCircle size={9} /> Working</span>
            <span className="tp-bubble">Ship it</span>
            <span className="tp-reply"><i /><i /></span>
            <span className="tp-btn">Apply</span>
          </div>
        </div>
      </div>
      <div className="tp-meta">
        <span className="tp-name">{t.name}</span>
        {on && <Check size={14} className="tp-on" aria-hidden />}
      </div>
      <div className="tp-tag">{t.tagline}</div>
      <div className="tp-facts">{SURFACE_WORD[t.structure.surfaces]} · {DENSITY_WORD[t.structure.density]} · {t.structure.radius ? `${t.structure.radius} px corners` : 'square corners'}</div>
    </button>
  )
}

/** Settings > Theme: cards grouped into Light, Dark and High contrast. */
export function ThemePicker({ current }: { current: ThemeId }) {
  const pick = (id: ThemeId): void => {
    applyTheme(id)
    void updateSettings({ theme: id })
  }
  return (
    <div className="theme-groups">
      {GROUPS.map((g) => (
        <div key={g.id} className="theme-group">
          <div className="theme-group-head"><span className="label">{g.label}</span><span className="muted small">{g.note}</span></div>
          <div className="theme-grid">
            {THEMES.filter((t) => t.group === g.id).map((t) => <ThemePreview key={t.id} t={t} on={current === t.id} onPick={() => pick(t.id)} />)}
          </div>
        </div>
      ))}
    </div>
  )
}
