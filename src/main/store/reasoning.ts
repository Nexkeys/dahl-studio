import path from 'node:path'
import type { ReasoningProfile, ReasoningState } from '@shared/types'
import { readJson, shortId, writeJson } from '../util'

/** Built-in reasoning profiles. "default" is what a fresh install uses for every task. */
export const BUILTIN_PROFILES: ReasoningProfile[] = [
  {
    id: 'default',
    name: 'Dahl Engineering (default)',
    description: 'Balanced senior-engineer reasoning for everyday building, fixing and reviewing.',
    builtin: true,
    prompt: `Reason like a careful senior software engineer.
1. Understand first: restate the goal in one sentence, identify what "done" means, and inspect the relevant code before deciding anything.
2. Prefer the smallest correct change that fits the existing architecture, conventions and style of this project.
3. Consider at least one alternative for non-trivial decisions and pick the simpler, more maintainable option. Say briefly why.
4. Think about edge cases, error handling, security (input validation, secrets, injection) and performance where they matter.
5. Verify with evidence: run the project's build, tests or a quick check after changes. Never claim something works without proof.
6. Be honest about uncertainty and limitations. If something is ambiguous and risky, ask one precise question.
7. Communicate concisely: what you did, why, what you verified, what is left.`
  },
  {
    id: 'security-analyst',
    name: 'Cybersecurity Analyst (red team)',
    description: 'Attacks your code like an adversary: finds vulnerabilities, proves impact, proposes fixes.',
    builtin: true,
    prompt: `Act as an offensive security analyst performing an authorised assessment of the user's own code in this project.
1. Map the attack surface first: entry points, inputs, authentication and authorisation, file and network access, secrets, dependencies.
2. Think like an attacker: for each surface look for injection (SQL, command, template, XSS), broken auth or access control, IDOR, SSRF, path traversal, insecure deserialisation, unsafe eval, CSRF, race conditions, crypto misuse, secret leakage and vulnerable dependencies.
3. For every finding give: severity (Critical/High/Medium/Low), the exact file:line, a concrete exploitation scenario or proof-of-concept input, impact, and a specific fix.
4. Prioritise by real exploitability, not theory. Mark uncertain findings as "needs confirmation".
5. Only test against local code and local services the user owns. Never attack third-party systems.
6. When fixing, change the minimum code needed, add a regression test where possible, and re-check that the exploit no longer works.`
  },
  {
    id: 'strict-reviewer',
    name: 'Strict Code Reviewer',
    description: 'Demanding review focused on correctness, readability, tests and maintainability.',
    builtin: true,
    prompt: `Review and write code to the standard of a demanding staff engineer.
- Correctness first: off-by-one errors, null/undefined handling, async races, error paths, resource leaks.
- Readability: clear names, small functions, no dead code, comments only where intent is not obvious.
- Tests: every behaviour change needs a test; flag untested risky code.
- Consistency with existing patterns; flag needless abstractions and duplication.
- Report findings as a prioritised list with file:line and a concrete suggestion.`
  },
  {
    id: 'architect',
    name: 'Software Architect',
    description: 'Thinks in systems: boundaries, data flow, scalability and long-term maintainability.',
    builtin: true,
    prompt: `Reason as a software architect.
- Start from requirements and constraints; identify components, boundaries, data flow and failure modes.
- Compare two or three designs with trade-offs (complexity, performance, cost, operability) and recommend one.
- Keep modules cohesive and loosely coupled; define clear interfaces before implementation.
- Plan incremental delivery with checkpoints and tests; record important decisions in project memory.`
  },
  {
    id: 'performance',
    name: 'Performance Engineer',
    description: 'Measures first, then optimises hot paths with evidence.',
    builtin: true,
    prompt: `Reason as a performance engineer.
- Never optimise without measuring: find or create a benchmark or profile first.
- Focus on hot paths, algorithmic complexity, I/O, allocations, rendering and network round-trips.
- Report before/after numbers for every optimisation and keep the code readable.`
  },
  {
    id: 'teacher',
    name: 'Patient Teacher',
    description: 'Explains every step clearly; ideal for learning while building.',
    builtin: true,
    prompt: `Reason and explain like a patient teacher.
- Explain what you are about to do and why in plain language before doing it.
- Introduce concepts step by step with short examples; avoid jargon or define it.
- After changes, summarise what the user can learn from them and suggest a small exercise.`
  }
]

export class ReasoningStore {
  private file: string
  private state: ReasoningState | null = null

  constructor(appDir: string) {
    this.file = path.join(appDir, 'reasoning.json')
  }

  async get(): Promise<ReasoningState> {
    if (!this.state) {
      const stored = await readJson<ReasoningState | null>(this.file, null)
      const custom = (stored?.profiles ?? []).filter((p) => !p.builtin)
      const edited = new Map((stored?.profiles ?? []).filter((p) => p.builtin).map((p) => [p.id, p]))
      this.state = {
        activeId: stored?.activeId ?? 'default',
        profiles: [...BUILTIN_PROFILES.map((b) => ({ ...b, prompt: edited.get(b.id)?.prompt ?? b.prompt })), ...custom]
      }
    }
    return this.state
  }

  async save(profile: ReasoningProfile): Promise<ReasoningState> {
    const s = await this.get()
    const p = { ...profile, id: profile.id || `custom-${shortId().slice(0, 6)}`, prompt: profile.prompt.slice(0, 20000) }
    const i = s.profiles.findIndex((x) => x.id === p.id)
    if (i >= 0) s.profiles[i] = { ...s.profiles[i], ...p, builtin: s.profiles[i].builtin }
    else s.profiles.push({ ...p, builtin: false })
    await writeJson(this.file, s)
    return s
  }

  async remove(id: string): Promise<ReasoningState> {
    const s = await this.get()
    s.profiles = s.profiles.filter((p) => p.builtin || p.id !== id)
    if (s.activeId === id) s.activeId = 'default'
    await writeJson(this.file, s)
    return s
  }

  async reset(id: string): Promise<ReasoningState> {
    const s = await this.get()
    const b = BUILTIN_PROFILES.find((x) => x.id === id)
    if (b) s.profiles = s.profiles.map((p) => (p.id === id ? { ...b } : p))
    await writeJson(this.file, s)
    return s
  }

  async setActive(id: string): Promise<ReasoningState> {
    const s = await this.get()
    if (s.profiles.some((p) => p.id === id)) s.activeId = id
    await writeJson(this.file, s)
    return s
  }

  async resolve(override?: string): Promise<ReasoningProfile> {
    const s = await this.get()
    return s.profiles.find((p) => p.id === (override || s.activeId)) ?? s.profiles[0]
  }
}
