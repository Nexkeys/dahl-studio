// evals.json in each skill folder: 3 tasks with a small fixture and pass criteria that can be checked from the run
// (tool calls, commands, final answer) or from the files afterwards. validateEvals checks the file's shape;
// checkCriteria grades a finished run (used by tests/skillEvals.live.test.ts).
import type { AgentMode } from '@shared/types'

export type Criterion =
  | { check: 'tool_called' | 'tool_not_called'; tool: string; args_pattern?: string; description: string }
  | { check: 'skill_used'; name: string; description: string }
  | { check: 'command_ran'; pattern: string; exit_code?: number; description: string }
  | { check: 'file_exists' | 'file_absent' | 'file_unchanged'; path: string; description: string }
  | { check: 'file_matches' | 'file_not_matches'; path: string; pattern: string; flags?: string; description: string }
  | { check: 'answer_matches' | 'answer_not_matches' | 'transcript_matches'; pattern: string; flags?: string; description: string }

export interface SkillEval {
  id: string
  prompt: string
  mode?: AgentMode
  web?: boolean
  fixture: { description: string; files: Record<string, string>; git?: boolean }
  criteria: Criterion[]
}

export interface EvalsFile {
  skill: string
  evals: SkillEval[]
}

const CHECKS = new Set(['tool_called', 'tool_not_called', 'skill_used', 'command_ran', 'file_exists', 'file_absent', 'file_unchanged', 'file_matches', 'file_not_matches', 'answer_matches', 'answer_not_matches', 'transcript_matches'])
const NEEDS: Record<string, string[]> = {
  tool_called: ['tool'], tool_not_called: ['tool'], skill_used: ['name'], command_ran: ['pattern'],
  file_exists: ['path'], file_absent: ['path'], file_unchanged: ['path'], file_matches: ['path', 'pattern'], file_not_matches: ['path', 'pattern'],
  answer_matches: ['pattern'], answer_not_matches: ['pattern'], transcript_matches: ['pattern']
}

const safePath = (p: string): boolean => !!p && !/^([a-z]:|[\\/])/i.test(p) && !p.split(/[\\/]/).includes('..')

/** Every problem with an evals.json (empty list when it is valid). */
export function validateEvals(raw: unknown, skillName: string, min = 3): string[] {
  const errs: string[] = []
  const f = raw as Partial<EvalsFile>
  if (!f || typeof f !== 'object') return ['evals.json is not an object']
  if (f.skill !== skillName) errs.push(`"skill" is "${String(f.skill)}", expected "${skillName}"`)
  if (!Array.isArray(f.evals)) return [...errs, '"evals" must be a list']
  if (f.evals.length < min) errs.push(`${f.evals.length} evals (at least ${min} required)`)
  const ids = new Set<string>()
  for (const [i, e] of f.evals.entries()) {
    const at = `eval ${i + 1}${e?.id ? ` (${e.id})` : ''}`
    if (!e || typeof e !== 'object') {
      errs.push(`${at}: not an object`)
      continue
    }
    if (typeof e.id !== 'string' || !e.id) errs.push(`${at}: missing id`)
    else if (ids.has(e.id)) errs.push(`${at}: duplicate id`)
    else ids.add(e.id)
    if (typeof e.prompt !== 'string' || !e.prompt.trim()) errs.push(`${at}: missing prompt`)
    if (e.mode !== undefined && !['plan', 'review', 'build'].includes(e.mode)) errs.push(`${at}: mode must be plan, review or build`)
    const fx = e.fixture
    if (!fx || typeof fx.description !== 'string' || !fx.description.trim()) errs.push(`${at}: fixture.description is required`)
    if (!fx || typeof fx.files !== 'object' || fx.files === null || Array.isArray(fx.files)) errs.push(`${at}: fixture.files must be an object (path: content)`)
    else for (const [p, c] of Object.entries(fx.files)) {
      if (!safePath(p)) errs.push(`${at}: fixture path "${p}" must be relative and inside the project`)
      if (typeof c !== 'string') errs.push(`${at}: fixture file "${p}" must be text`)
    }
    if (!Array.isArray(e.criteria) || !e.criteria.length) {
      errs.push(`${at}: needs at least one criterion`)
      continue
    }
    for (const [j, c] of e.criteria.entries()) {
      const where = `${at} criterion ${j + 1}`
      if (!c || !CHECKS.has(c.check)) {
        errs.push(`${where}: unknown check "${String(c?.check)}"`)
        continue
      }
      for (const k of NEEDS[c.check]) if (typeof (c as Record<string, unknown>)[k] !== 'string' || !(c as Record<string, string>)[k]) errs.push(`${where}: ${c.check} needs "${k}"`)
      if (typeof c.description !== 'string' || !c.description.trim()) errs.push(`${where}: missing description`)
      if ('path' in c && typeof c.path === 'string' && !safePath(c.path)) errs.push(`${where}: path must be relative`)
      const flags = 'flags' in c ? c.flags : undefined
      if (flags !== undefined && !/^[ims]*$/.test(flags)) errs.push(`${where}: flags may only use i, m, s`)
      for (const k of ['pattern', 'args_pattern'] as const) {
        const src = (c as Record<string, unknown>)[k]
        if (typeof src !== 'string') continue
        try {
          new RegExp(src, flags)
        } catch (err) {
          errs.push(`${where}: ${k} is not a valid regex (${(err as Error).message})`)
        }
      }
    }
  }
  return errs
}

/** What a finished eval run looks like to the grader. */
export interface EvalRun {
  prompt: string
  toolCalls: { name: string; args: string }[]
  commands: { command: string; exitCode: number | null }[]
  answer: string
  /** assistant text and tool results, joined */
  transcript: string
  /** file content after the run (null when missing) and before it (from the fixture) */
  readFile(path: string): string | null
  original(path: string): string | null
}

export function checkCriterion(c: Criterion, r: EvalRun): boolean {
  const re = (p: string, flags?: string) => new RegExp(p, flags)
  const calls = (tool: string, args?: string) => r.toolCalls.filter((t) => t.name === tool && (!args || re(args, 'i').test(t.args)))
  switch (c.check) {
    case 'tool_called': return calls(c.tool, c.args_pattern).length > 0
    case 'tool_not_called': return calls(c.tool, c.args_pattern).length === 0
    case 'skill_used': return r.prompt.trim().startsWith(`/${c.name}`) || r.toolCalls.some((t) => t.name === 'use_skill' && new RegExp(`"name"\\s*:\\s*"/?${c.name}"`).test(t.args))
    case 'command_ran': return r.commands.some((x) => re(c.pattern, 'i').test(x.command) && (c.exit_code === undefined || x.exitCode === c.exit_code))
    case 'file_exists': return r.readFile(c.path) !== null
    case 'file_absent': return r.readFile(c.path) === null
    case 'file_unchanged': return r.readFile(c.path) === r.original(c.path)
    case 'file_matches': return re(c.pattern, c.flags).test(r.readFile(c.path) ?? '')
    case 'file_not_matches': return !re(c.pattern, c.flags).test(r.readFile(c.path) ?? '')
    case 'answer_matches': return re(c.pattern, c.flags).test(r.answer)
    case 'answer_not_matches': return !re(c.pattern, c.flags).test(r.answer)
    case 'transcript_matches': return re(c.pattern, c.flags).test(r.transcript)
  }
}

export function gradeEval(e: SkillEval, r: EvalRun): { id: string; passed: boolean; results: { description: string; passed: boolean }[] } {
  const results = e.criteria.map((c) => ({ description: c.description, passed: checkCriterion(c, r) }))
  return { id: e.id, passed: results.every((x) => x.passed), results }
}
