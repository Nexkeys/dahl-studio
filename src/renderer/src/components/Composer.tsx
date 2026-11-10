import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Paperclip, Globe, Sparkles, X, FileText, Folder, Image as ImageIcon, ListTodo, Search, Hammer, Brain, AtSign, Plug, Blocks, Clock, OctagonX, Briefcase } from 'lucide-react'
import type { AgentMode, Attachment, McpServerConfig, SkillList, SkillSummary, StartRunRequest, ThinkingLevel } from '@shared/types'
import { mcpCommands, parseMcpCommand, type McpCommand } from '@shared/mcpCommands'
import { sendHow, type SendHow } from '@shared/outbox'
import { isPdfAttachment, limitMessage, MAX_IMAGES_PER_MESSAGE } from '@shared/imageLimits'
import { addAttachments, api, updateSettings, useStore } from '../store'
import { skillIcon, skillLabel } from './skills'
import { ModelMenu } from './ModelMenu'
import { CHIEF_PROMPT } from '../chief'
import { PresetSwitch } from './PresetSwitch'

const NO_ATTS: Attachment[] = []
const MODES: { id: AgentMode; label: string; icon: typeof Hammer; hint: string }[] = [
  { id: 'plan', label: 'Plan', icon: ListTodo, hint: 'Read-only: investigate and produce a plan' },
  { id: 'review', label: 'Review', icon: Search, hint: 'Read-only: find bugs and risks' },
  { id: 'build', label: 'Build', icon: Hammer, hint: 'Edit files and run commands (with approval)' }
]
const THINK: { id: ThinkingLevel; label: string }[] = [
  { id: 'off', label: 'Fast' }, { id: 'low', label: 'Light' }, { id: 'medium', label: 'Balanced' }, { id: 'high', label: 'Deep' }
]

const MB = 1024 * 1024
function fileToAttachment(f: File, i = 0): Promise<Attachment> {
  const isImg = f.type.startsWith('image/')
  const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
  const max = isImg ? 15 * MB : isPdf ? 40 * MB : MB
  if (f.size > max) return Promise.reject(new Error(`${f.name || 'File'} is larger than ${max / MB} MB`))
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result)
      // several images pasted at once arrive with the same generic name; number them so each stays distinct
      const name = f.name && !/^image\.\w+$/i.test(f.name) ? f.name : `pasted-${Date.now()}-${i + 1}.${(f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`
      resolve(isImg
        ? { id: crypto.randomUUID(), kind: 'image', name, mediaType: f.type, data: s.split(',')[1], bytes: f.size }
        : isPdf
          ? { id: crypto.randomUUID(), kind: 'file', name: f.name, mediaType: 'application/pdf', data: s.split(',')[1], bytes: f.size }
          : { id: crypto.randomUUID(), kind: 'file', name: f.name, text: s, bytes: f.size })
    }
    r.onerror = () => reject(r.error)
    if (isImg || isPdf) r.readAsDataURL(f)
    else r.readAsText(f)
  })
}

export function Composer({ root, running, onSend }: { root: string; running: boolean; onSend: (text: string, mcpServers?: StartRunRequest['mcpServers'], how?: SendHow) => void }) {
  const [input, setInput] = useState('')
  const [menu, setMenu] = useState<null | 'attach' | 'skills' | 'mention'>(null)
  const [files, setFiles] = useState<string[]>([])
  const [mq, setMq] = useState('')
  const [mcp, setMcp] = useState<McpCommand[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [skipped, setSkipped] = useState<string[]>([])
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

  // skills (SKILL.md folders: built-in, yours, the project's) and MCP slash commands (/mcp and one per enabled
  // server); both are refreshed whenever the skills menu opens. Skill names are reserved so MCP commands never clash.
  const loadMcp = async (names?: string[]) => {
    const reserved = (names ?? skills.map((s) => s.name)).map((n) => `/${n}`)
    return api.invoke<{ servers: McpServerConfig[] }>('mcp:list').then((l) => {
      const cmds = mcpCommands(l.servers, reserved)
      setMcp(cmds)
      return cmds
    }).catch(() => [] as McpCommand[])
  }
  const skillsOpen = menu === 'skills'
  useEffect(() => {
    void api.invoke<SkillList>('skills:list', root).catch(() => ({ skills: [], problems: [] }) as SkillList).then((l) => {
      setSkills(l.skills)
      setSkipped(l.problems.filter((p) => p.level === 'error').map((p) => `${p.path}: ${p.reason}`))
      void loadMcp(l.skills.map((s) => s.name))
    })
  }, [skillsOpen, root])

  const typed = input.trim().toLowerCase()
  const cmdMatch = (cmd: string) => !typed.startsWith('/') || typed === '/' || cmd.startsWith(typed)
  const mcpHits = mcp.filter((c) => c.enabled && cmdMatch(c.cmd))
  const mentionHits = useMemo(() => (mq ? files.filter((f) => f.toLowerCase().includes(mq.toLowerCase())) : files).slice(0, 8), [files, mq])

  /** add files, telling the user about any over the limits or unreadable */
  const addFiles = async (files: File[]) => {
    const read = await Promise.allSettled(files.map((f, i) => fileToAttachment(f, i)))
    const ok = read.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const failed = read.flatMap((r) => (r.status === 'rejected' ? [(r.reason as Error).message] : []))
    const msg = [limitMessage(addAttachments(root, ok)), ...failed.slice(0, 2)].filter(Boolean).join(' ')
    if (msg) notify(msg, 'error')
  }
  const pick = async (kind: 'file' | 'folder' | 'image') => {
    setMenu(null)
    try {
      const msg = limitMessage(addAttachments(root, await api.invoke<Attachment[]>('attach:pick', root, kind)))
      if (msg) notify(msg, 'error')
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const onPaste = async (e: React.ClipboardEvent) => {
    // several copied images or files arrive together; some apps only fill `items`
    let files = [...e.clipboardData.files]
    if (!files.length) files = [...e.clipboardData.items].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter((f): f is File => !!f)
    const wanted = files.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    if (!wanted.length) return
    e.preventDefault()
    await addFiles(wanted)
  }
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length) await addFiles([...e.dataTransfer.files])
  }
  const imageCount = atts.filter((a) => a.kind === 'image').length
  const onChange = async (v: string) => {
    setInput(v)
    const caret = ta.current?.selectionStart ?? v.length
    const at = /(^|\s)@([\w./-]*)$/.exec(v.slice(0, caret))
    if (at) {
      if (!files.length) setFiles(await api.invoke<string[]>('fs:listAll', root).catch(() => []))
      setMq(at[2])
      setMenu('mention')
    } else if (/^\/[\w-]*$/.test(v)) setMenu('skills')
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
  const send = async (how?: SendHow) => {
    const text = input.trim()
    if (!text) return
    setInput('')
    setMenu(null)
    // "/<server> request" or "/mcp request": focus the run on that server (or on all MCP tools)
    const hit = text.startsWith('/') ? parseMcpCommand(text, mcp.length ? mcp : await loadMcp()) : null
    onSend(text, hit ? (hit.id ? [hit.id] : 'all') : undefined, running ? how ?? 'steer' : undefined)
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
          {imageCount > 0 && (
            <span className={`att-count small${imageCount >= MAX_IMAGES_PER_MESSAGE ? ' full' : ''}`} title={`Up to ${MAX_IMAGES_PER_MESSAGE} images per message`}>
              {imageCount}/{MAX_IMAGES_PER_MESSAGE} images{imageCount >= MAX_IMAGES_PER_MESSAGE ? ': limit reached' : ''}
            </span>
          )}
          {(imageCount > 0 || atts.some(isPdfAttachment)) && model && !model.vision && <span className="muted small">This model cannot see images: Dahl reads each image and PDF before sending (text, layout, colours).</span>}
        </div>
      )}
      <div className="composer-box">
        <textarea ref={ta} value={input} rows={3} aria-label="Message Dahl" onPaste={onPaste}
          placeholder={running ? 'Dahl is working. Enter: tell Dahl now (it reads this at its next step). Alt+Enter: send after this task. Ctrl+Enter: stop and send.' : 'Ask Dahl to build, fix or explain. Type / for skills and MCP servers, @ to attach a file, paste images.'}
          onChange={(e) => void onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMenu(null)
            if (e.key === 'Enter' && !e.shiftKey && menu !== 'mention') { e.preventDefault(); void send(sendHow(e)) }
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
            {skills.filter((s) => s.userInvocable && cmdMatch(`/${s.name}`)).map((s) => {
              const Icon = skillIcon(s)
              return (
                <button key={s.name} className="popover-item skill-item" title={`${s.description}\n\n${s.location}${s.argumentHint ? `\nType after the command: ${s.argumentHint}` : ''}`}
                  onClick={() => { setInput(`/${s.name} `); if (s.mode) set({ mode: s.mode }); if (s.web) set({ web: true }); setMenu(null); ta.current?.focus() }}>
                  <Icon size={14} /><span className="skill-row"><b>/{s.name}</b> <span className="muted">{skillLabel(s)}</span></span>
                  {s.source !== 'builtin' && <span className="pill">{s.source === 'project' ? 'project' : 'yours'}</span>}
                </button>
              )
            })}
            {cmdMatch('/chief') && (
              <button className="popover-item skill-item" title="Chief of Staff: briefing across all open projects"
                onClick={() => { setInput(CHIEF_PROMPT); set({ mode: 'plan' }); setMenu(null); ta.current?.focus() }}>
                <Briefcase size={14} /><span className="skill-row"><b>/chief</b> <span className="muted">Chief of Staff: briefing across all open projects</span></span>
              </button>
            )}
            {skipped.length > 0 && typed === '/' &&<div className="muted small pad" title={skipped.join('\n')}>{skipped.length} skill folder{skipped.length > 1 ? 's' : ''} skipped (invalid SKILL.md); hover for the reason</div>}
            {mcpHits.length > 0 && <div className="popover-title"><Plug size={12} /> MCP servers</div>}
            {mcpHits.map((c) => (
              <button key={c.cmd} className="popover-item" title={c.id ? `Type a request after ${c.cmd}, or send it alone to see what ${c.name} can do` : 'Type a request after /mcp, or send it alone to list connected servers and tools'}
                onClick={() => { setInput(`${c.cmd} `); setMenu(null); ta.current?.focus() }}>
                {c.id ? <Plug size={14} /> : <Blocks size={14} />}<span><b>{c.cmd}</b> <span className="muted">{c.label}</span></span>
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
        <PresetSwitch />
        <label className="think" title={model?.thinking === 'native' ? 'Uses the provider\'s native reasoning setting' : 'App-level thinking guidance (this model has no documented reasoning parameter)'}>
          <Brain size={13} />
          <select value={settings?.thinking ?? 'medium'} onChange={(e) => updateSettings({ thinking: e.target.value as ThinkingLevel })} aria-label="Thinking depth">
            {THINK.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <ModelMenu />
        <span className="grow" />
        {running && input.trim() && (
          <>
            <button className="tool-toggle" title="Send after this task (Alt+Enter)" onClick={() => void send('queue')}><Clock size={13} /> <span>After task</span></button>
            <button className="tool-toggle danger" title="Stop the task and send this now (Ctrl+Enter)" onClick={() => void send('stop')}><OctagonX size={13} /> <span>Stop and send</span></button>
          </>
        )}
        <button className="btn primary send" onClick={() => void send('steer')} disabled={!input.trim()} aria-label={running ? 'Tell Dahl now' : 'Send'} title={running ? 'Tell Dahl now: it reads this at its next step (Enter)' : 'Send (Enter)'}><Send size={15} /></button>
      </div>
    </div>
  )
}
