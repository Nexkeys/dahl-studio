// Runs the built-in skills' evals.json tasks against a real model and grades each run. Skipped unless
// DAHL_EVAL_MODEL is set; start it with: node scripts/skill-evals.mjs --model <model id> [--skill fix,tests]
// Each eval gets a fresh temp folder with its fixture files. File writes are auto-approved; commands only with
// --allow-commands (DAHL_EVAL_COMMANDS=1); questions, pushes and GitHub writes are always declined.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRunner } from '../src/main/agent/runner'
import { streamChat, DAHL_V1 } from '../src/main/dahl/client'
import { ProcessManager } from '../src/main/terminal'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import { loadSkills } from '../src/main/skills/loader'
import { gradeEval, type EvalsFile, type SkillEval } from '../src/main/skills/evals'
import { webFetch, webSearch } from '../src/main/tools/web'
import type { AgentEvent, RunState } from '../src/shared/types'

const MODEL = process.env.DAHL_EVAL_MODEL ?? ''
const KEY = process.env.DAHL_EVAL_KEY ?? process.env.DAHL_API_KEY ?? ''
const BASE = process.env.DAHL_EVAL_BASE_URL ?? DAHL_V1
const ONLY = (process.env.DAHL_EVAL_SKILL ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const COMMANDS = process.env.DAHL_EVAL_COMMANDS === '1'
const WEB = process.env.DAHL_EVAL_WEB === '1'
const OUT = process.env.DAHL_EVAL_OUT ?? path.join(os.tmpdir(), `dahl-skill-evals-${Date.now()}.json`)
const SKILLS_DIR = path.resolve('skills')
const report: unknown[] = []

async function runEval(skill: string, e: SkillEval) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `dahl-eval-${e.id}-`))
  for (const [rel, text] of Object.entries(e.fixture.files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
    await fs.writeFile(path.join(dir, rel), text)
  }
  if (e.fixture.git) {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    git('add', '-A')
    git('-c', 'user.name=Eval', '-c', 'user.email=eval@example.invalid', 'commit', '-q', '-m', 'fixture', '--allow-empty')
  }
  const procs = new ProcessManager()
  const events: AgentEvent[] = []
  const runner: AgentRunner = new AgentRunner({
    backend: { chat: (req, signal, cb) => streamChat(KEY, req, signal, cb, fetch, { baseUrl: BASE }) },
    getSettings: async () => ({ ...DEFAULT_SETTINGS, autoApproveWrites: true, autoApproveCommands: COMMANDS, maintainProgress: false, autoMemory: false }),
    emit: (ev) => {
      events.push(ev)
      if (ev.type !== 'approval' || !ev.approval) return
      const a = ev.approval
      const feedback = a.kind === 'question' ? 'The user is not available in this evaluation. Proceed with your recommended option and state the assumption.' : 'Not allowed in this evaluation harness. Continue without it and say what you would have done.'
      setTimeout(() => runner.resolveApproval(a.id, false, feedback), 0)
    },
    runCommand: (c, cwd, t, sig) => procs.run(c, cwd, t, sig),
    secrets: async () => (KEY ? [KEY] : []),
    web: WEB ? { search: (q, max, sig) => webSearch(q, sig, max), fetch: (u, sig) => webFetch(u, sig) } : undefined,
    skills: async () => ({ skills: (await loadSkills([{ dir: SKILLS_DIR, source: 'builtin', label: 'built-in' }])).skills }),
    maxIterations: 30
  })
  const started = Date.now()
  const sum = await runner.start({ project: dir, prompt: e.prompt, mode: e.mode ?? 'build', model: MODEL, web: !!e.web && WEB })
  while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 200))
  const run = JSON.parse(await fs.readFile(path.join(dir, '.dahl', 'runs', `${sum.id}.json`), 'utf8')) as RunState
  const toolCalls = run.messages.flatMap((m) => (m.tool_calls ?? []).map((t) => ({ name: t.function.name, args: t.function.arguments })))
  const answer = [...run.transcript].reverse().find((t) => t.kind === 'assistant')?.text ?? ''
  const transcript = run.transcript.map((t) => (t.kind === 'tool' ? `${t.text}\n${t.tool?.result ?? ''}` : t.text)).join('\n')
  const read = (rel: string): string | null => {
    try {
      return readFileSync(path.join(dir, rel), 'utf8')
    } catch {
      return null
    }
  }
  const graded = gradeEval(e, { prompt: e.prompt, toolCalls, commands: run.commandsRun, answer, transcript, readFile: read, original: (p) => e.fixture.files[p] ?? null })
  report.push({ skill, ...graded, status: run.status, error: run.lastError, seconds: Math.round((Date.now() - started) / 1000), folder: dir })
  await fs.writeFile(OUT, JSON.stringify({ model: MODEL, base: BASE, commands: COMMANDS, web: WEB, results: report }, null, 2))
  return graded
}

const evalFiles = async (): Promise<EvalsFile[]> => {
  const out: EvalsFile[] = []
  for (const d of (await fs.readdir(SKILLS_DIR)).sort()) {
    if (ONLY.length && !ONLY.includes(d)) continue
    const raw = await fs.readFile(path.join(SKILLS_DIR, d, 'evals.json'), 'utf8').catch(() => null)
    if (raw) out.push(JSON.parse(raw))
  }
  return out
}

describe.skipIf(!MODEL)(`skill evals against ${MODEL || '(no model)'}`, async () => {
  if (!MODEL) return void it('needs a model: node scripts/skill-evals.mjs --model <id>', () => {})
  for (const f of await evalFiles())
    for (const e of f.evals)
      it.skipIf(!!e.web && !WEB)(`${f.skill} / ${e.id}`, async () => {
        const g = await runEval(f.skill, e)
        expect(g.results.filter((r) => !r.passed).map((r) => r.description), `report: ${OUT}`).toEqual([])
      }, 15 * 60_000)
})
