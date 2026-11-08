// use_skill and read_skill_file. read_skill_file only reads inside the skill's own folder (same boundary check as
// project files: no "..", no absolute paths, no symlinks pointing out).
import { promises as fs } from 'node:fs'
import type { Skill } from './loader'
import { renderSkill } from './prompt'
import { resolveInside, PathBoundaryError } from '../fs/workspace'

export interface SkillToolResult {
  ok: boolean
  text: string
}

const MAX_READ = 100_000

function find(skills: Skill[], name: unknown): Skill | undefined {
  const want = String(name ?? '').trim().replace(/^\//, '').toLowerCase()
  return skills.find((s) => s.name === want)
}

const known = (skills: Skill[]): string => skills.filter((s) => s.modelInvocable).map((s) => s.name).join(', ') || 'none'

export async function execUseSkill(skills: Skill[], a: { name?: unknown; arguments?: unknown }): Promise<SkillToolResult> {
  const s = find(skills, a.name)
  if (!s) return { ok: false, text: `No skill called "${String(a.name ?? '')}". Available: ${known(skills)}.` }
  if (!s.modelInvocable) return { ok: false, text: `The ${s.name} skill can only be started by the user (they type /${s.name}). Tell them, if it fits the request.` }
  return { ok: true, text: `Skill loaded. Follow these instructions for the current request.\n${await renderSkill(s, String(a.arguments ?? ''))}` }
}

export async function execReadSkillFile(skills: Skill[], a: { skill?: unknown; path?: unknown }): Promise<SkillToolResult> {
  const s = find(skills, a.skill)
  if (!s) return { ok: false, text: `No skill called "${String(a.skill ?? '')}".` }
  const rel = String(a.path ?? '').replace(/\\/g, '/').trim()
  if (!rel) return { ok: false, text: 'Give the path of a file inside the skill folder, for example references/checklist.md.' }
  let abs: string
  try {
    abs = await resolveInside(s.dir, rel)
  } catch (e) {
    if (e instanceof PathBoundaryError) return { ok: false, text: `read_skill_file only reads files inside the ${s.name} skill folder: ${rel} is outside it.` }
    throw e
  }
  const st = await fs.stat(abs).catch(() => null)
  if (!st) return { ok: false, text: `${rel} does not exist in the ${s.name} skill.` }
  if (st.isDirectory()) {
    const names = (await fs.readdir(abs, { withFileTypes: true })).map((e) => e.name + (e.isDirectory() ? '/' : ''))
    return { ok: true, text: `${rel}/ contains: ${names.join(', ') || '(empty)'}` }
  }
  const buf = await fs.readFile(abs)
  if (buf.subarray(0, 8000).includes(0)) return { ok: false, text: `${rel} is a binary file (${st.size} bytes); it cannot be shown as text.` }
  const text = buf.toString('utf8')
  return { ok: true, text: `${s.name}/${rel}:\n${text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n[truncated: ${text.length - MAX_READ} more characters]` : text}` }
}
