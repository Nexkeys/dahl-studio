// How skills reach the model: a short list in the system prompt (name and description only, within a budget),
// the body when the model calls use_skill, and the body in the user's message when they run /<name>.
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Skill } from './loader'

/** About 1% of a 200k-token context; the list degrades to short descriptions, then to names, when it is longer. */
export const SKILL_LIST_BUDGET = 9000

const firstSentence = (s: string, max: number): string => {
  const m = /^.*?[.!?](?=\s|$)/.exec(s)
  const t = (m ? m[0] : s).trim()
  return t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t
}

/** The SKILLS section of the system prompt, or '' when no skill is available to the model. */
export function skillsPromptSection(skills: Skill[], budget = SKILL_LIST_BUDGET): string {
  // project and personal skills first, so they survive when the list is shortened
  const rank = { project: 0, user: 1, builtin: 2 } as const
  const listed = skills.filter((s) => s.modelInvocable).sort((a, b) => rank[a.source] - rank[b.source] || a.name.localeCompare(b.name))
  if (!listed.length) return ''
  const head = [
    'SKILLS: tested step-by-step instructions for common jobs. When the request matches a skill below, call use_skill with its name (and the request as arguments) BEFORE you start, then follow what it returns. Load at most two skills per request, only when they clearly match.',
    'If the user\'s message already contains a skill\'s instructions (they ran /<name>), follow them and do not load it again. A skill that changes files needs Build mode.'
  ].join(' ')
  const full = (s: Skill): string => `- ${s.name}: ${s.description}${s.whenToUse ? ` ${s.whenToUse}` : ''}`
  const short = (s: Skill): string => `- ${s.name}: ${firstSentence(s.description, 140)}`
  let lines = listed.map(full)
  if (lines.join('\n').length > budget) lines = listed.map(short)
  let used = 0
  const out: string[] = []
  const rest: string[] = []
  for (const [i, l] of lines.entries()) {
    if (!rest.length && used + l.length + 1 <= budget) {
      out.push(l)
      used += l.length + 1
    } else rest.push(listed[i].name)
  }
  if (rest.length) out.push(`- Also available (call use_skill to read what they do): ${rest.join(', ')}`)
  return `${head}\n${out.join('\n')}`
}

/** Split arguments like a shell: spaces separate, quotes group. */
export function splitArgs(args: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(args); m; m = re.exec(args)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/**
 * $ARGUMENTS becomes everything the user typed after the command, $ARGUMENTS[N] the Nth word (0-based).
 * ${DAHL_SKILL_DIR} (and Claude Code's ${CLAUDE_SKILL_DIR}) becomes the skill folder. Bare $1 is left alone:
 * skills often show shell or regex examples that use it. Without a placeholder, arguments are appended.
 */
export function substituteArgs(body: string, args: string, dir?: string): string {
  const words = splitArgs(args)
  let used = false
  let out = body.replace(/\$ARGUMENTS\[(\d+)\]/g, (_m, n: string) => ((used = true), words[Number(n)] ?? ''))
  out = out.replace(/\$ARGUMENTS\b/g, () => ((used = true), args.trim()))
  if (dir) out = out.replace(/\$\{(?:DAHL|CLAUDE)_SKILL_DIR\}/g, dir)
  if (!used && args.trim()) out += `\n\nARGUMENTS: ${args.trim()}`
  return out
}

/** "/fix the total is wrong" -> { name: "fix", args: "the total is wrong" } */
export function parseSkillCommand(text: string): { name: string; args: string } | null {
  const m = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return m ? { name: m[1], args: (m[2] ?? '').trim() } : null
}

/** Other files in the skill folder (scripts/, references/, assets/), relative paths, at most 60. */
export async function skillFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 3 || out.length >= 60) return
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p, depth + 1)
      else if (out.length < 60) out.push(path.relative(dir, p).replace(/\\/g, '/'))
    }
  }
  await walk(dir, 0)
  return out.filter((f) => f !== 'SKILL.md' && f !== 'evals.json').sort()
}

/** The skill as the model receives it: body with arguments, plus the list of its other files. */
export async function renderSkill(s: Skill, args: string): Promise<string> {
  const files = await skillFiles(s.dir)
  return [
    `<skill name="${s.name}" source="${s.location}">`,
    substituteArgs(s.body, args, s.dir),
    '</skill>',
    files.length ? `Files in this skill (open one with read_skill_file, skill "${s.name}", only when you need it): ${files.join(', ')}` : ''
  ].filter(Boolean).join('\n')
}

/**
 * The model-side text for a message that runs a skill (/<name> args), or null when the message is not a skill
 * command. Skills hidden from the menu (user-invocable: false) are not run this way.
 */
export async function expandSkillCommand(skills: Skill[], text: string): Promise<{ skill: Skill; text: string } | null> {
  const cmd = parseSkillCommand(text)
  const skill = cmd && skills.find((s) => s.name === cmd.name && s.userInvocable)
  if (!cmd || !skill) return null
  const intro = `The user ran the /${skill.name} skill${cmd.args ? ` with: ${cmd.args}` : ' without arguments'}. Follow its instructions for this request.`
  return { skill, text: `${intro}\n\n${await renderSkill(skill, cmd.args)}` }
}
