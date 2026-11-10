// Every built-in skill in the top-level skills/ folder: valid frontmatter, the sections an effective skill needs,
// and a valid evals.json with 3 tasks. Run the evals against a model with: node scripts/skill-evals.mjs --model <name>
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { loadSkills } from '../src/main/skills/loader'
import { skillsPromptSection, SKILL_LIST_BUDGET } from '../src/main/skills/prompt'
import { validateEvals, checkCriterion, gradeEval, type EvalRun, type SkillEval } from '../src/main/skills/evals'

const DIR = path.resolve('skills')
// the 12 original / menu skills rewritten as SKILL.md, plus the 35 added in 0.4.0
export const CORE_SKILLS = [
  'explain', 'fix', 'tests', 'review', 'security', 'refactor', 'docs', 'commit', 'research', 'perf', 'ui', 'find',
  'debug-stack-trace', 'reproduce-first', 'flaky-test', 'fix-types-and-lint', 'web-e2e-tests', 'coverage-gaps', 'api-tests', 'dead-code',
  'dependency-upgrade', 'spec-to-tasks', 'architecture-decision', 'onboard-project', 'secrets-scan', 'dependency-audit', 'auth-review',
  'sekudo-assessment', 'web-vitals', 'bundle-size', 'slow-queries', 'responsive-audit', 'accessibility-audit', 'component-library',
  'landing-page', 'rest-endpoint', 'db-migration', 'supabase-backend', 'data-analysis', 'github-actions-ci', 'fix-ci', 'release',
  'deploy-web', 'open-pr', 'review-pr', 'resolve-conflicts', 'mobile-app'
]
const SECTIONS = ['## When to use', '## When not to use', '## Mode', '## Checklist', '## Verify', '## Output', '## Pitfalls']
const TOOLS = /\b(read_file|search|edit_file|write_file|run_command|git|github|web_search|ask_user|delegate_agents|use_connector|update_plan|list_dir|analyze_image)\b/

async function allFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await allFiles(p)))
    else out.push(p)
  }
  return out
}

describe('built-in skills', async () => {
  const { skills, problems } = await loadSkills([{ dir: DIR, source: 'builtin', label: 'built-in' }])
  const byName = new Map(skills.map((s) => [s.name, s]))

  it('has all 47 core skills and no invalid skill folder', () => {
    expect(CORE_SKILLS).toHaveLength(47)
    expect(problems.filter((p) => p.level === 'error')).toEqual([])
    expect(CORE_SKILLS.filter((n) => !byName.has(n))).toEqual([])
  })

  it.each(CORE_SKILLS)('%s: description, sections, tools, mode note and length', async (name) => {
    const s = byName.get(name)!
    expect(s.description.length).toBeGreaterThan(60)
    expect(s.description.length).toBeLessThanOrEqual(1024)
    expect(s.description, 'the description must say when to use it').toMatch(/\bUse (it )?(when|for|to|after|before)\b/i)
    expect(s.description, 'third person').not.toMatch(/^(I|You|We)\b/)
    expect(s.mode, 'metadata dahl-mode').toBeDefined()
    for (const h of SECTIONS) expect(s.body, `${name} is missing "${h}"`).toContain(h)
    expect(s.body).toContain('$ARGUMENTS')
    expect(s.body).toMatch(TOOLS)
    expect(s.body.split('\n').length).toBeLessThan(500)
    if (s.mode === 'build') expect(s.body, `${name} changes files: it must say it needs Build mode`).toMatch(/Build mode/)
  })

  it.each(CORE_SKILLS)('%s: evals.json has 3 valid evals', async (name) => {
    const raw = JSON.parse(await fs.readFile(path.join(DIR, name, 'evals.json'), 'utf8'))
    expect(validateEvals(raw, name)).toEqual([])
    expect(raw.evals).toHaveLength(3)
  })

  it('evals.json of any other built-in skill is valid when present', async () => {
    for (const s of skills.filter((x) => !CORE_SKILLS.includes(x.name))) {
      const raw = await fs.readFile(path.join(DIR, s.name, 'evals.json'), 'utf8').catch(() => null)
      if (raw) expect(validateEvals(JSON.parse(raw), s.name, 1), s.name).toEqual([])
    }
  })

  it('no file under skills/ contains an em or en dash', async () => {
    const bad: string[] = []
    for (const f of await allFiles(DIR)) if (/[–—]/.test(await fs.readFile(f, 'utf8'))) bad.push(path.relative(DIR, f))
    expect(bad).toEqual([])
  })

  it('the list in the system prompt fits the budget with every description in full', () => {
    const text = skillsPromptSection(skills)
    expect(text.length).toBeLessThanOrEqual(SKILL_LIST_BUDGET + 600)
    expect(text).not.toContain('Also available')
  })
})

describe('eval grading', () => {
  const e: SkillEval = {
    id: 'x', prompt: 'please fix', fixture: { description: 'd', files: { 'a.js': 'old' } },
    criteria: [
      { check: 'skill_used', name: 'fix', description: 'loaded' },
      { check: 'command_ran', pattern: 'npm test', exit_code: 0, description: 'tests' },
      { check: 'file_matches', path: 'a.js', pattern: 'NEW', flags: 'i', description: 'changed' },
      { check: 'answer_matches', pattern: 'root cause', flags: 'i', description: 'cause' },
      { check: 'tool_not_called', tool: 'git_push', description: 'no push' }
    ]
  }
  const run = (over: Partial<EvalRun>): EvalRun => ({
    prompt: 'please fix', toolCalls: [{ name: 'use_skill', args: '{"name":"fix"}' }], commands: [{ command: 'npm test', exitCode: 0 }],
    answer: 'The root cause was X.', transcript: '', readFile: () => 'new', original: () => 'old', ...over
  })
  it('passes a good run and pinpoints what a bad run missed', () => {
    expect(gradeEval(e, run({})).passed).toBe(true)
    const bad = gradeEval(e, run({ toolCalls: [{ name: 'git_push', args: '{}' }], commands: [{ command: 'npm test', exitCode: 1 }], readFile: () => 'old' }))
    expect(bad.results.filter((r) => !r.passed).map((r) => r.description)).toEqual(['loaded', 'tests', 'changed', 'no push'])
    expect(checkCriterion({ check: 'file_unchanged', path: 'a.js', description: '' }, run({ readFile: () => 'old' }))).toBe(true)
    expect(checkCriterion({ check: 'skill_used', name: 'fix', description: '' }, run({ prompt: '/fix it', toolCalls: [] }))).toBe(true)
  })
  it('validateEvals reports shape errors', () => {
    expect(validateEvals({ skill: 'a', evals: [{ id: 'a', prompt: '', fixture: { description: '', files: { '../x': 1 } }, criteria: [{ check: 'nope' }, { check: 'file_matches', path: 'a', pattern: '(', description: 'd' }] }] }, 'a')).toEqual([
      '1 evals (at least 3 required)',
      'eval 1 (a): missing prompt',
      'eval 1 (a): fixture.description is required',
      'eval 1 (a): fixture path "../x" must be relative and inside the project',
      'eval 1 (a): fixture file "../x" must be text',
      'eval 1 (a) criterion 1: unknown check "nope"',
      expect.stringMatching(/criterion 2: pattern is not a valid regex/)
    ])
  })
})
