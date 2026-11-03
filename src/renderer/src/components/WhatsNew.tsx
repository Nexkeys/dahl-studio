import { useEffect, useRef } from 'react'
import { X, Sparkles, MessagesSquare, Palette, PanelTop, MessageCircleQuestion, GitMerge, GitPullRequest, Plug, Globe, Users, Gauge, ShieldCheck, Keyboard, ExternalLink } from 'lucide-react'
import { updateSettings, useStore } from '../store'
import { currentNotes, notesSince, type NoteIcon } from '../whatsNew'
import iconUrl from '../assets/icon.png'
import '../ui-whatsnew.css'

const ICONS: Record<NoteIcon, typeof Sparkles> = {
  sparkles: Sparkles, chats: MessagesSquare, palette: Palette, tabs: PanelTop, question: MessageCircleQuestion, git: GitMerge, github: GitPullRequest,
  plug: Plug, globe: Globe, agents: Users, gauge: Gauge, shield: ShieldCheck, keyboard: Keyboard
}

/** Shown once after an update (and from the palette or Settings). Uses the theme's variables, so it matches every theme. */
export function WhatsNew() {
  const req = useStore((s) => s.whatsNew)
  const version = useStore((s) => s.appVersion)
  const set = useStore((s) => s.set)
  const ok = useRef<HTMLButtonElement>(null)
  const notes = !req ? [] : req.since ? notesSince(req.since, version) : currentNotes(version)
  const [latest, ...older] = notes

  const close = () => {
    set({ whatsNew: null })
    if (version) void updateSettings({ lastSeenVersion: version })
  }
  useEffect(() => {
    if (!req) return
    ok.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])

  if (!req || !latest) return null
  return (
    <div className="wn-backdrop" onMouseDown={close}>
      <div className="wn" role="dialog" aria-modal="true" aria-labelledby="wn-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wn-hero">
          <img src={iconUrl} alt="" className="wn-logo" />
          <div className="wn-heading">
            <span className="wn-eyebrow">{req.since ? `Updated to version ${latest.version}` : `Version ${latest.version}`} <span className="wn-date">{new Date(latest.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</span></span>
            <h2 id="wn-title">{latest.title}</h2>
            <p>{latest.summary}</p>
          </div>
          <button className="icon-btn wn-x" aria-label="Close" onClick={close}><X size={16} /></button>
        </div>

        <div className="wn-body">
          <div className="wn-grid">
            {latest.items.map((it) => {
              const Icon = ICONS[it.icon]
              return (
                <div key={it.title} className="wn-item">
                  <span className="wn-ico"><Icon size={17} strokeWidth={1.8} /></span>
                  <div className="wn-text"><b>{it.title}</b><p>{it.text}</p></div>
                </div>
              )
            })}
          </div>
          {older.length > 0 && (
            <details className="wn-older">
              <summary>Also new since you last updated ({older.map((r) => r.version).join(', ')})</summary>
              {older.map((r) => (
                <section key={r.version}>
                  <h3>{r.version} <span className="muted">{r.title}</span></h3>
                  <ul>{r.items.map((it) => <li key={it.title}><b>{it.title}.</b> {it.text}</li>)}</ul>
                </section>
              ))}
            </details>
          )}
        </div>

        <div className="wn-foot">
          <a className="link small" href="https://github.com/Nexkeys/dahl-studio/releases" target="_blank" rel="noreferrer"><ExternalLink size={12} /> All release notes</a>
          <span className="grow" />
          <button ref={ok} className="btn primary" onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  )
}
