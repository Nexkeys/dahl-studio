import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFrontmatter } from '../src/main/skills/frontmatter'
import { loadSkills, skillRoots, type Skill } from '../src/main/skills/loader'
import { expandSkillCommand, parseSkillCommand, skillsPromptSection, substituteArgs } from '../src/main/skills/prompt'
import { execReadSkillFile, execUseSkill } from '../src/main/skills/tools'
import { AgentRunner, type ChatBackend } from '../src/main/agent/runner'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { AgentEvent, ChatMessage } from '../src/shared/types'

let tmp: string
const write = async (rel: string, text: string) => {
  await fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true })
  await fs.writeFile(path.join(tmp, rel), text)
}
const skill = (name: string, description: string, body = 'Do it: $ARGUMENTS', extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n${body}\n`
const roots = () => skillRoots(path.join(tmp, 'builtin'), path.join(tmp, 'user'), path.join(tmp, 'proj'))

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-skills-'))
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('frontmatter', () => {
  it('reads scalars, quotes, booleans, block scalars, lists and one nested map (CRLF too)', () => {
    const fm = parseFrontmatter('---\r\nname: fix\r\ndescription: "Fixes: bugs"\r\nflag: true\r\nlong: >\r\n  one\r\n  two\r\nlist:\r\n  - a\r\n  - "b"\r\ninline: [x, y]\r\nmetadata:\r\n  dahl-mode: build\r\n---\r\n# Body\r\n')
    expect(fm.error).toBeUndefined()
    expect(fm.data).toMatchObject({ name: 'fix', description: 'Fixes: bugs', flag: true, long: 'one two', list: ['a', 'b'], inline: ['x', 'y'], metadata: { 'dahl-mode': 'build' } })
    expect(fm.body).toBe('# Body\n')
  })
  it('reports an unclosed block and files without frontmatter', () => {
    expect(parseFrontmatter('---\nname: x\n').error).toMatch(/not closed/)
    expect(parseFrontmatter('# just markdown').present).toBe(false)
  })
})

describe('skill loader', () => {
  it('loads valid skills and skips invalid ones with a reason', async () => {
    await write('builtin/good/SKILL.md', skill('good', 'Does good things. Use when testing.', 'Body', 'argument-hint: "<x>"\nmetadata:\n  dahl-mode: build\n  dahl-icon: bug\n'))
    await write('builtin/mismatch/SKILL.md', skill('other-name', 'x'))
    await write('builtin/Bad_Name/SKILL.md', skill('Bad_Name', 'x'))
    await write('builtin/nodesc/SKILL.md', '---\nname: nodesc\n---\nBody\n')
    await write('builtin/long/SKILL.md', skill('long', 'x'.repeat(1025)))
    await write('builtin/nofm/SKILL.md', '# no frontmatter\n')
    await write('builtin/badmode/SKILL.md', skill('badmode', 'x', 'Body', 'metadata:\n  dahl-mode: yolo\n'))
    await write('builtin/notaskill/README.md', 'nothing')
    const r = await loadSkills(roots())
    expect(r.skills.map((s) => s.name)).toEqual(['good'])
    expect(r.skills[0]).toMatchObject({ source: 'builtin', location: 'built-in', mode: 'build', icon: 'bug', argumentHint: '<x>', userInvocable: true, modelInvocable: true })
    const reasons = Object.fromEntries(r.problems.filter((p) => p.level === 'error').map((p) => [p.path, p.reason]))
    expect(reasons['built-in/mismatch']).toMatch(/does not match its folder/)
    expect(reasons['built-in/Bad_Name']).toMatch(/lowercase/)
    expect(reasons['built-in/nodesc']).toMatch(/description/)
    expect(reasons['built-in/long']).toMatch(/max 1024/)
    expect(reasons['built-in/nofm']).toMatch(/frontmatter/)
    expect(reasons['built-in/badmode']).toMatch(/dahl-mode/)
  })

  it('project skills override user skills, which override built-in ones (.dahl wins over .claude and .agents)', async () => {
    await write('builtin/deploy/SKILL.md', skill('deploy', 'built-in'))
    await write('user/deploy/SKILL.md', skill('deploy', 'user'))
    await write('builtin/lint/SKILL.md', skill('lint', 'built-in lint'))
    await write('user/lint/SKILL.md', skill('lint', 'user lint'))
    await write('proj/.agents/skills/deploy/SKILL.md', skill('deploy', 'agents'))
    await write('proj/.claude/skills/deploy/SKILL.md', skill('deploy', 'claude'))
    await write('proj/.dahl/skills/deploy/SKILL.md', skill('deploy', 'dahl'))
    await write('proj/.claude/skills/only-claude/SKILL.md', skill('only-claude', 'from claude'))
    const r = await loadSkills(roots())
    const by = Object.fromEntries(r.skills.map((s) => [s.name, s]))
    expect(by.deploy.description).toBe('dahl')
    expect(by.deploy.location).toBe('.dahl/skills/deploy')
    expect(by.lint).toMatchObject({ description: 'user lint', source: 'user' })
    expect(by['only-claude']).toMatchObject({ source: 'project', location: '.claude/skills/only-claude' })
  })
})

const fake = (over: Partial<Skill>): Skill => ({ name: 'x', description: 'X.', source: 'builtin', location: 'built-in', userInvocable: true, modelInvocable: true, dir: tmp, file: '', body: 'B', ...over })

describe('skills in the prompt and the / command', () => {
  it('lists name and description, hides disable-model-invocation skills and stays within the budget', () => {
    const list = [fake({ name: 'alpha', description: 'Alpha does a. Use when a.' }), fake({ name: 'hidden', modelInvocable: false }), fake({ name: 'proj', source: 'project', description: 'Project one.' })]
    const text = skillsPromptSection(list)
    expect(text).toMatch(/call use_skill/)
    expect(text).toContain('- alpha: Alpha does a. Use when a.')
    expect(text).not.toContain('hidden')
    expect(text.indexOf('- proj')).toBeLessThan(text.indexOf('- alpha'))
    const many = Array.from({ length: 60 }, (_, i) => fake({ name: `s${i}`, description: `Sentence one for ${i}. ${'More detail. '.repeat(20)}` }))
    // too long in full: first sentences only; still too long: the rest by name
    const small = skillsPromptSection(many, 1000)
    expect(small).not.toContain('More detail')
    expect(small).toContain('- s0: Sentence one for 0.')
    expect(small).toMatch(/Also available \(call use_skill to read what they do\): .*s9$/)
    expect(small.length).toBeLessThan(1800)
    expect(skillsPromptSection([fake({ modelInvocable: false })])).toBe('')
  })

  it('substitutes $ARGUMENTS and $ARGUMENTS[N], appends arguments when there is no placeholder, keeps $1', () => {
    expect(substituteArgs('Fix: $ARGUMENTS ($ARGUMENTS[1])', 'login "is broken"')).toBe('Fix: login "is broken" (is broken)')
    expect(substituteArgs('Replace with $1', 'abc')).toBe('Replace with $1\n\nARGUMENTS: abc')
    expect(substituteArgs('Dir ${CLAUDE_SKILL_DIR}/x', '', 'C:/s')).toBe('Dir C:/s/x')
    expect(parseSkillCommand('/fix-ci  the build ')).toEqual({ name: 'fix-ci', args: 'the build' })
    expect(parseSkillCommand('fix it')).toBeNull()
  })

  it('a / command expands user-invocable skills (also disable-model-invocation ones) but not hidden ones', async () => {
    const list = [fake({ name: 'release', modelInvocable: false, body: 'Release $ARGUMENTS' }), fake({ name: 'secret', userInvocable: false })]
    const r = await expandSkillCommand(list, '/release 1.2.0')
    expect(r?.text).toContain('The user ran the /release skill with: 1.2.0')
    expect(r?.text).toContain('Release 1.2.0')
    expect(await expandSkillCommand(list, '/secret go')).toBeNull()
    expect(await expandSkillCommand(list, '/unknown')).toBeNull()
  })

  it('use_skill returns the body and extra files; read_skill_file never leaves the skill folder', async () => {
    await write('s/fix/SKILL.md', skill('fix', 'Fixes.'))
    await write('s/fix/references/check.md', 'checklist')
    await write('s/fix/evals.json', '{}')
    await write('s/secret.txt', 'outside')
    const s = fake({ name: 'fix', dir: path.join(tmp, 's', 'fix'), body: 'Do it: $ARGUMENTS' })
    const used = await execUseSkill([s], { name: 'fix', arguments: 'the bug' })
    expect(used.ok).toBe(true)
    expect(used.text).toContain('Do it: the bug')
    expect(used.text).toContain('references/check.md')
    expect(used.text).not.toContain('evals.json')
    expect((await execReadSkillFile([s], { skill: 'fix', path: 'references/check.md' })).text).toContain('checklist')
    for (const p of ['../secret.txt', '..\\secret.txt', path.join(tmp, 's', 'secret.txt'), 'references/../../secret.txt']) {
      const r = await execReadSkillFile([s], { skill: 'fix', path: p })
      expect(r.ok).toBe(false)
      expect(r.text).toMatch(/only reads files inside/)
    }
    expect((await execUseSkill([fake({ name: 'rel', modelInvocable: false })], { name: 'rel' })).text).toMatch(/only be started by the user/)
    expect((await execUseSkill([s], { name: 'nope' })).ok).toBe(false)
  })
})

describe('skills in a real run', () => {
  it('/<skill> sends the skill to the model, lists skills and offers use_skill; the chat shows what the user typed', async () => {
    const project = path.join(tmp, 'proj')
    await write('proj/a.txt', 'x')
    const list = [fake({ name: 'fix', description: 'Fixes bugs. Use when broken.', body: 'Steps for: $ARGUMENTS' }), fake({ name: 'explain', description: 'Explains.' })]
    const seen: { messages: ChatMessage[]; tools: string[] }[] = []
    const backend: ChatBackend = {
      async chat(req) {
        seen.push({ messages: req.messages, tools: (req.tools as { function: { name: string } }[]).map((t) => t.function.name) })
        return seen.length === 1
          ? { content: '', reasoning: '', toolCalls: [{ id: 'c1', type: 'function' as const, function: { name: 'use_skill', arguments: '{"name":"explain"}' } }] }
          : { content: 'done', reasoning: '', toolCalls: [] }
      }
    }
    const events: AgentEvent[] = []
    const runner = new AgentRunner({
      backend, getSettings: async () => ({ ...DEFAULT_SETTINGS, maintainProgress: false, autoMemory: false }), emit: (e) => events.push(e),
      runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [], skills: async () => ({ skills: list })
    })
    await runner.start({ project, prompt: '/fix the total is wrong', mode: 'build', model: 'm' })
    while (runner.isActive(project)) await new Promise((r) => setTimeout(r, 5))
    const user = seen[0].messages.find((m) => m.role === 'user')!
    expect(JSON.stringify(user.content)).toContain('Steps for: the total is wrong')
    expect(String(seen[0].messages[0].content)).toContain('- fix: Fixes bugs. Use when broken.')
    expect(seen[0].tools).toEqual(expect.arrayContaining(['use_skill', 'read_skill_file']))
    expect(JSON.stringify(seen[1].messages.find((m) => m.role === 'tool')?.content)).toContain('<skill name=\\"explain\\"')
    const userItem = events.find((e) => e.type === 'transcript' && e.item?.kind === 'user')
    expect(userItem?.item?.text).toBe('/fix the total is wrong')
  })
})
