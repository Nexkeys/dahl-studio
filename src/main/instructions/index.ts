// Project instruction files in the system prompt, labelled and capped. Root files come first; files in the folders
// being worked on follow, deepest last, and the prompt says the closest one wins when they disagree.
import type { ChatMessage, InstructionFileInfo } from '@shared/types'
import { claudeWithImports, cursorRules, foldersOf, readProjectFile, type Source } from './sources'

export const INSTRUCTIONS_TOTAL_CAP = 24_000
export const INSTRUCTIONS_FILE_CAP = 8_000

export interface InstructionSet {
  /** the prompt section ('' when the project has none) */
  text: string
  files: InstructionFileInfo[]
}

export interface WorkingSet {
  /** project-relative files being read, edited or attached (Cursor globs match these) */
  files: string[]
  /** folders being listed or worked in */
  dirs?: string[]
  /** the user's message: @rule-name mentions load manual Cursor rules */
  prompt?: string
}

const FILE_TOOLS = new Set(['read_file', 'edit_file', 'write_file', 'append_file', 'view_image', 'analyze_image'])

/** Files and folders this conversation touched, newest last: tool call paths and @mentions in user messages. */
export function workingSet(messages: ChatMessage[], attached: string[] = []): { files: string[]; dirs: string[] } {
  const files: string[] = [...attached]
  const dirs: string[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => (p.type === 'text' ? p.text : '')).join(' ')
      for (const hit of text.matchAll(/(?:^|\s)@([\w./-]+\.[\w]+)/g)) files.push(hit[1])
    }
    for (const tc of m.tool_calls ?? []) {
      if (!FILE_TOOLS.has(tc.function.name) && tc.function.name !== 'list_dir') continue
      let p = ''
      try {
        p = String((JSON.parse(tc.function.arguments || '{}') as { path?: unknown }).path ?? '')
      } catch {
        continue
      }
      p = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
      if (!p || p.startsWith('..') || /^[a-z]:/i.test(p)) continue
      ;(tc.function.name === 'list_dir' ? dirs : files).push(p)
    }
  }
  const last = (a: string[]): string[] => [...new Set(a.reverse())].slice(0, 40).reverse()
  return { files: last(files), dirs: last(dirs) }
}

async function gather(root: string, w: WorkingSet): Promise<Source[]> {
  const folders = foldersOf([...w.files, ...(w.dirs ?? []).map((d) => `${d}/.`)])
  const seen = new Set<string>()
  const out: Source[] = []
  const add = async (rel: string, kind: Source['kind'], reason: string) => {
    if (seen.has(rel.toLowerCase())) return
    const text = await readProjectFile(root, rel)
    if (text === null) return
    seen.add(rel.toLowerCase())
    out.push({ path: rel, kind, reason, content: text })
  }
  out.push(...(await claudeWithImports(root, 'CLAUDE.md', 'project root', seen)))
  out.push(...(await claudeWithImports(root, '.claude/CLAUDE.md', 'project root', seen)))
  await add('AGENTS.md', 'agents', 'project root')
  await add('.github/copilot-instructions.md', 'copilot', 'GitHub Copilot instructions')
  await add('.cursorrules', 'cursorrules', 'legacy Cursor rules')
  const rules = await cursorRules(root, folders, w.files, w.prompt ?? '')
  out.push(...rules.filter((r) => r.reason === 'alwaysApply'))
  for (const f of folders) {
    out.push(...(await claudeWithImports(root, `${f}/CLAUDE.md`, `applies to ${f}/`, seen)))
    await add(`${f}/AGENTS.md`, 'agents', `applies to ${f}/`)
  }
  out.push(...rules.filter((r) => r.reason !== 'alwaysApply'))
  return out
}

const LABEL: Record<InstructionFileInfo['kind'], string> = {
  claude: 'CLAUDE.md', agents: 'AGENTS.md', 'cursor-rule': 'Cursor rule', cursorrules: 'Cursor rules', copilot: 'Copilot', import: 'import'
}

/** Read every instruction file that applies and build the labelled, size-capped prompt section. */
export async function loadInstructions(root: string, w: WorkingSet = { files: [] }, cap = INSTRUCTIONS_TOTAL_CAP): Promise<InstructionSet> {
  const sources = await gather(root, w)
  const files: InstructionFileInfo[] = []
  const blocks: string[] = []
  const listed: string[] = []
  let left = cap
  for (const s of sources) {
    if (s.listed) {
      listed.push(`- ${s.path}: ${s.reason.slice(0, 200)}`)
      files.push({ path: s.path, kind: s.kind, reason: 'read on request', chars: 0, listed: true })
      continue
    }
    const body = s.content.trim()
    if (!body) continue
    const room = Math.min(left, INSTRUCTIONS_FILE_CAP)
    if (room < 300) {
      files.push({ path: s.path, kind: s.kind, reason: `${s.reason}; not loaded, over the size limit`, chars: 0, truncated: true })
      listed.push(`- ${s.path}: not loaded (instruction size limit reached); read it with read_file if it matters`)
      continue
    }
    const truncated = body.length > room
    const text = truncated ? `${body.slice(0, room)}\n[truncated: ${body.length - room} more characters; read the rest with read_file]` : body
    left -= Math.min(body.length, room)
    blocks.push(`=== ${s.path} (${LABEL[s.kind]}, ${s.reason}) ===\n${text}`)
    files.push({ path: s.path, kind: s.kind, reason: s.reason, chars: body.length, truncated: truncated || undefined })
  }
  if (!blocks.length && !listed.length) return { text: '', files: [] }
  const head = 'PROJECT INSTRUCTION FILES: written by this project\'s developers for coding agents (CLAUDE.md, AGENTS.md, Cursor and Copilot rules). Follow their conventions unless they conflict with the user\'s request or the rules above. When two files disagree, the one in the folder closest to the file you are working on wins (files are listed root first, deepest last).'
  const more = listed.length ? `\nOther rules (read one with read_file when it is relevant to the task):\n${listed.join('\n')}` : ''
  return { text: `${head}\n\n${blocks.join('\n\n')}${more}`, files }
}
