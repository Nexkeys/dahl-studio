// Agent Skills (agentskills.io): every folder with a SKILL.md is a skill. Only name and description go into the
// prompt; the body is loaded when the skill is used (use_skill or a / command), other files on demand.
import path from 'node:path'
import { promises as fs, readdirSync, statSync, type Dirent } from 'node:fs'
import type { AgentMode, SkillProblem, SkillSource, SkillSummary } from '@shared/types'
import { parseFrontmatter, type FmValue } from './frontmatter'

export interface Skill extends SkillSummary {
  /** absolute folder and SKILL.md path */
  dir: string
  file: string
  body: string
  allowedTools?: string[]
  whenToUse?: string
  compatibility?: string
}

/** A folder that holds skill folders. Later entries override earlier ones with the same skill name. */
export interface SkillRoot {
  dir: string
  source: SkillSource
  /** shown to the user, e.g. ".claude/skills" or "built-in" */
  label: string
}

export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_FILE_BYTES = 256 * 1024
const MODES: AgentMode[] = ['plan', 'review', 'build']
const KNOWN_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'argument-hint', 'disable-model-invocation', 'user-invocable', 'when_to_use', 'when-to-use', 'model', 'context', 'agent', 'hooks', 'version'])

/** Project skill folders, lowest precedence first: Dahl's own folder wins over other tools' folders. */
export const PROJECT_SKILL_DIRS = ['.github/skills', '.cursor/skills', '.agents/skills', '.claude/skills', '.dahl/skills']

export function skillRoots(builtinDir: string, userDir: string, project: string | null): SkillRoot[] {
  const roots: SkillRoot[] = [{ dir: builtinDir, source: 'builtin', label: 'built-in' }, { dir: userDir, source: 'user', label: 'your skills' }]
  if (project) for (const d of PROJECT_SKILL_DIRS) roots.push({ dir: path.join(project, d), source: 'project', label: d })
  return roots
}

const str = (v: FmValue | undefined): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)

/** Check frontmatter against the Agent Skills rules. Returns the reason it is invalid, or null. Warnings are pushed to `warnings`. */
export function validateSkillFrontmatter(data: Record<string, FmValue>, folder: string, body: string, warnings: string[] = []): string | null {
  const name = data.name
  if (typeof name !== 'string' || !name) return 'missing required "name"'
  if (name.length > 64) return `name is longer than 64 characters`
  if (!NAME_RE.test(name)) return `name "${name}" must use lowercase letters, digits and single hyphens`
  if (name !== folder) return `name "${name}" does not match its folder "${folder}"`
  const d = data.description
  if (typeof d !== 'string' || !d.trim()) return 'missing required "description"'
  if (d.length > 1024) return `description is ${d.length} characters (max 1024)`
  for (const k of ['license', 'compatibility', 'argument-hint', 'when_to_use'] as const)
    if (data[k] !== undefined && typeof data[k] !== 'string') return `"${k}" must be text`
  if (typeof data.compatibility === 'string' && data.compatibility.length > 500) return '"compatibility" is longer than 500 characters'
  for (const k of ['disable-model-invocation', 'user-invocable'] as const)
    if (data[k] !== undefined && typeof data[k] !== 'boolean') return `"${k}" must be true or false`
  const meta = data.metadata
  if (meta !== undefined && meta !== '' && (typeof meta !== 'object' || Array.isArray(meta))) return '"metadata" must be a map of text values'
  const mode = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta['dahl-mode'] : undefined
  if (mode && !MODES.includes(mode as AgentMode)) return `metadata dahl-mode "${mode}" must be plan, review or build`
  const tools = data['allowed-tools']
  if (tools !== undefined && typeof tools !== 'string' && !Array.isArray(tools)) return '"allowed-tools" must be text or a list'
  if (!body.trim()) return 'SKILL.md has no instructions after the frontmatter'
  const lines = body.split('\n').length
  if (lines > 500) warnings.push(`body has ${lines} lines (keep it under 500; move detail into references/)`)
  for (const k of Object.keys(data)) if (!KNOWN_KEYS.has(k)) warnings.push(`unknown frontmatter key "${k}" (ignored)`)
  return null
}

const cache = new Map<string, { mtimeMs: number; size: number; result: { skill?: Skill; error?: string; warnings: string[] } }>()

async function readSkill(dir: string, root: SkillRoot): Promise<{ skill?: Skill; error?: string; warnings: string[] }> {
  const file = path.join(dir, 'SKILL.md')
  const st = statSync(file)
  const hit = cache.get(file)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.result
  const result = await parseSkill(file, dir, root, st.size)
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, result })
  return result
}

async function parseSkill(file: string, dir: string, root: SkillRoot, size: number): Promise<{ skill?: Skill; error?: string; warnings: string[] }> {
  const warnings: string[] = []
  if (size > MAX_FILE_BYTES) return { error: `SKILL.md is larger than ${MAX_FILE_BYTES / 1024} KB`, warnings }
  const fm = parseFrontmatter(await fs.readFile(file, 'utf8'))
  if (!fm.present) return { error: 'SKILL.md has no YAML frontmatter (--- name, description ---)', warnings }
  if (fm.error) return { error: fm.error, warnings }
  const folder = path.basename(dir)
  const error = validateSkillFrontmatter(fm.data, folder, fm.body, warnings)
  if (error) return { error, warnings }
  const meta = (typeof fm.data.metadata === 'object' && !Array.isArray(fm.data.metadata) ? fm.data.metadata : {}) as Record<string, string>
  const tools = fm.data['allowed-tools']
  const skill: Skill = {
    name: fm.data.name as string,
    description: (fm.data.description as string).replace(/\s+/g, ' ').trim(),
    source: root.source,
    location: root.source === 'builtin' ? 'built-in' : `${root.label}/${folder}`,
    argumentHint: str(fm.data['argument-hint']),
    userInvocable: fm.data['user-invocable'] !== false,
    modelInvocable: fm.data['disable-model-invocation'] !== true,
    mode: MODES.includes(meta['dahl-mode'] as AgentMode) ? (meta['dahl-mode'] as AgentMode) : undefined,
    icon: meta['dahl-icon'] || undefined,
    web: meta['dahl-web'] === 'true' || undefined,
    dir, file,
    body: fm.body.trim(),
    allowedTools: Array.isArray(tools) ? tools : typeof tools === 'string' ? tools.split(/[\s,]+/).filter(Boolean) : undefined,
    whenToUse: str(fm.data.when_to_use) ?? str(fm.data['when-to-use']),
    compatibility: str(fm.data.compatibility)
  }
  return { skill, warnings }
}

/** Load every skill under the roots. Invalid skills are skipped and reported in `problems`. */
export async function loadSkills(roots: SkillRoot[]): Promise<{ skills: Skill[]; problems: SkillProblem[] }> {
  const byName = new Map<string, Skill>()
  const problems: SkillProblem[] = []
  for (const root of roots) {
    // directory listing and stats are synchronous: the runner asks before model calls, and on a busy PC each async
    // fs call queued for about 200 ms (sync: a few ms); file contents are read (async) only when they changed
    let entries: Dirent[] = []
    try {
      entries = readdirSync(root.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const dir = path.join(root.dir, e.name)
      if (!statSync(path.join(dir, 'SKILL.md'), { throwIfNoEntry: false })?.isFile()) continue
      const where = root.source === 'builtin' ? `built-in/${e.name}` : `${root.label}/${e.name}`
      try {
        const r = await readSkill(dir, root)
        for (const w of r.warnings) problems.push({ path: where, reason: w, level: 'warning' })
        if (r.error || !r.skill) problems.push({ path: where, reason: r.error ?? 'unreadable', level: 'error' })
        else byName.set(r.skill.name, r.skill)
      } catch (err) {
        problems.push({ path: where, reason: (err as Error).message, level: 'error' })
      }
    }
  }
  return { skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), problems }
}

/** What the renderer gets: no bodies, no absolute paths. */
export function summarize(s: Skill): SkillSummary {
  const { name, description, source, location, argumentHint, userInvocable, modelInvocable, mode, icon, web } = s
  return { name, description, source, location, argumentHint, userInvocable, modelInvocable, mode, icon, web }
}
