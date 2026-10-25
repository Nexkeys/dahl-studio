import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Paperclip, Globe, Sparkles, X, FileText, Folder, Image as ImageIcon, ListTodo, Search, Hammer, Brain, AtSign } from 'lucide-react'
import type { AgentMode, Attachment, ThinkingLevel } from '@shared/types'
import { addAttachments, api, updateSettings, useStore } from '../store'
import { SKILLS } from './skills'

const NO_ATTS: Attachment[] = []
const MODES: { id: AgentMode; label: string; icon: typeof Hammer; hint: string }[] = [
  { id: 'plan', label: 'Plan', icon: ListTodo, hint: 'Read-only: investigate and produce a plan' },
  { id: 'review', label: 'Review', icon: Search, hint: 'Read-only: find bugs and risks' },
  { id: 'build', label: 'Build', icon: Hammer, hint: 'Edit files and run commands (with approval)' }
]
const THINK: { id: ThinkingLevel; label: string }[] = [
  { id: 'off', label: 'Fast' }, { id: 'low', label: 'Light' }, { id: 'medium', label: 'Balanced' }, { id: 'high', label: 'Deep' }
]

function fileToAttachment(f: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result)
      const isImg = f.type.startsWith('image/')
      resolve(isImg
        ? { id: crypto.randomUUID(), kind: 'image', name: f.name || `pasted-${Date.now()}.png`, mediaType: f.type, data: s.split(',')[1], bytes: f.size }
        : { id: crypto.randomUUID(), kind: 'file', name: f.name, text: s, bytes: f.size })
    }
    r.onerror = () => reject(r.error)
    if (f.type.startsWith('image/')) r.readAsDataURL(f)
    else r.readAsText(f)
  })
}

export function Composer({ root, running, onSend }: { root: string; running: boolean; onSend: (text: string) => void }) {
  const [input, setInput] = useState('')
  const [menu, setMenu] = useState<null | 'attach' | 'skills' | 'mention'>(null)
  const [files, setFiles] = useState<string[]>([])
  const [mq, setMq] = useState('')
  const ta = useRef<HTMLTextAreaElement>(null)
  const atts = useStore((s) => s.projects[root]?.attachments) ?? NO_ATTS
  const mode = useStore((s) => s.mode)
  const web = useStore((s) => s.web)
  const settings = useStore((s) => s.settings)
  const models = useStore((s) => s.models)
  const insert = useStore((s) => s.composerInsert)
  const { set, patchProject, notify } = useStore.getState()
  const model = models.find((m) => m.key === settings?.defaultModel)

  useEffect(() => {
    if (insert) {
      setInput((v) => (v ? v + '\n' : '') + insert)
      set({ composerInsert: null })
      ta.current?.focus()
    }
  }, [insert, set])

  const mentionHits = useMemo(() => (mq ? files.filter((f) => f.toLowerCase().includes(mq.toLowerCase())) : files).slice(0, 8), [files, mq])

  const pick = async (kind: 'file' | 'folder' | 'image') => {
    setMenu(null)
    try {
      addAttachments(root, await api.invoke<Attachment[]>('attach:pick', root, kind))
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const onPaste = async (e: React.ClipboardEvent) => {
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    e.preventDefault()
    addAttachments(root, await Promise.all(imgs.map(fileToAttachment)))
  }
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length) addAttachments(root, await Promise.all([...e.dataTransfer.files].map(fileToAttachment)))
  }
  const onChange = async (v: string) => {
    setInput(v)
    const caret = ta.current?.selectionStart ?? v.length
    const at = /(^|\s)@([\w./-]*)$/.exec(v.slice(0, caret))
    if (at) {
      if (!files.length) setFiles(await api.invoke<string[]>('fs:listAll', root).catch(() => []))
      setMq(at[2])
      setMenu('mention')
    } else if (/^\/\w*$/.test(v)) setMenu('skills')
    else if (menu === 'mention' || menu === 'skills') setMenu(null)
  }
  const chooseMention = async (f: string) => {
    setInput((v) => v.replace(/@([\w./-]*)$/, `@${f} `))
    setMenu(null)
    try {
      addAttachments(root, [await api.invoke<Attachment>('attach:path', root, f)])
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const send = () => {
    const text = input.trim()
    if (!text || running) return
    setInput('')
    onSend(text)
  }

  return (
    <div className="composer" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      {atts.length > 0 && (
        <div className="att-row">
          {atts.map((a) => (
            <span key={a.id} className={`att ${a.kind}`}>
              {a.kind === 'image' ? <img src={`data:${a.mediaType};base64,${a.data}`} alt="" /> : a.kind === 'folder' ? <Folder size={13} /> : <FileText size={13} />}
              <span className="att-name">{a.name}</span>
              <button className="icon-btn tiny" aria-label={`Remove ${a.name}`} onClick={() => patchProject(root, (c) => ({ attachments: c.attachments.filter((x) => x.id !== a.id) }))}><X size={11} /></button>
            </span>
          ))}
          {atts.some((a) => a.kind === 'image') && model && !model.vision && <span className="muted small">This model cannot see images; Dahl will use image analysis (OCR + layout breakdown).</span>}
        </div>
      )}
      <div className="composer-box">
        <textarea ref={ta} value={input} rows={3} disabled={running} aria-label="Message Dahl" onPaste={onPaste}
          placeholder={running ? 'Dahl is working. Pause or cancel to send a new instruction.' : 'Ask Dahl to build, fix or explain. Type / for skills, @ to attach a file, paste images.'}
          onChange={(e) => void onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMenu(null)
            if (e.key === 'Enter' && !e.shiftKey && menu !== 'mention') { e.preventDefault(); send() }
          }} />
        {menu === 'mention' && (
          <div className="popover up">
            <div className="popover-title"><AtSign size={12} /> Attach a project file</div>
            {mentionHits.map((f) => <button key={f} className="popover-item" onClick={() => chooseMention(f)}><FileText size={13} /> {f}</button>)}
            {!mentionHits.length && <div className="muted small pad">No matching files</div>}
          </div>
        )}
        {menu === 'skills' && (
          <div className="popover up wide">
            <div className="popover-title"><Sparkles size={12} /> Skills</div>
            {SKILLS.filter((s) => !input.startsWith('/') || s.cmd.startsWith(input.trim()) || input.trim() === '/').map((s) => (
              <button key={s.cmd} className="popover-item" onClick={() => { setInput(s.prompt); if (s.mode) set({ mode: s.mode }); if (s.web) set({ web: true }); setMenu(null); ta.current?.focus() }}>
                <s.icon size={14} /><span><b>{s.cmd}</b> <span className="muted">{s.label}</span></span>
              </button>
            ))}
          </div>
        )}
        {menu === 'attach' && (
          <div className="popover up">
            <button className="popover-item" onClick={() => pick('file')}><FileText size={14} /> Files</button>
            <button className="popover-item" onClick={() => pick('folder')}><Folder size={14} /> Folder</button>
            <button className="popover-item" onClick={() => pick('image')}><ImageIcon size={14} /> Image</button>
          </div>
        )}
      </div>
      <div className="composer-bar">
        <button className={`tool-toggle ${menu === 'attach' ? 'on' : ''}`} title="Attach files, folders or images" onClick={() => setMenu(menu === 'attach' ? null : 'attach')}><Paperclip size={14} /></button>
        <button className={`tool-toggle ${web ? 'on' : ''}`} title={web ? 'Web research on: Dahl may search and read web pages' : 'Web research off'} aria-pressed={web} onClick={() => set({ web: !web })}><Globe size={14} /> <span>Web</span></button>
        <button className={`tool-toggle ${menu === 'skills' ? 'on' : ''}`} title="Skills" onClick={() => setMenu(menu === 'skills' ? null : 'skills')}><Sparkles size={14} /> <span>Skills</span></button>
        <div className="segmented" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'on' : ''} title={m.hint} onClick={() => set({ mode: m.id })}><m.icon size={13} /> {m.label}</button>
          ))}
        </div>
        <label className="think" title={model?.thinking === 'native' ? 'Uses the provider\'s native reasoning setting' : 'App-level thinking guidance (this model has no documented reasoning parameter)'}>
          <Brain size={13} />
          <select value={settings?.thinking ?? 'medium'} onChange={(e) => updateSettings({ thinking: e.target.value as ThinkingLevel })} aria-label="Thinking depth">
            {THINK.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <span className="grow" />
        <button className="btn primary send" onClick={send} disabled={running || !input.trim()} aria-label="Send"><Send size={15} /></button>
      </div>
    </div>
  )
}
