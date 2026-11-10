/**
 * Hallucination guards: checks that do not depend on the model being honest.
 * 1. Read before edit: an existing file can only be changed by an agent that read it (or wrote it) in this task.
 * 2. Claims need evidence: "tests pass", "the build succeeds" and "lint is clean" are checked against the commands
 *    that really ran in this task, and "I created `x`" against the files that really exist.
 * 3. report_blocked: a way to stop honestly instead of inventing a result (the tool lives in tools.ts / toolExec.ts).
 * Everything here is pure, so it is tested without a model.
 */

export type ClaimKind = 'test' | 'build' | 'check'
export interface RanCommand { command: string; exitCode: number | null }
export interface Unsupported {
  kind: ClaimKind
  /** the words of the reply that make the claim */
  quote: string
  /** why it is not supported: no such command ran, or the last one failed */
  why: 'not_run' | 'failed'
  command?: string
  exitCode?: number | null
}

/** Which commands count as evidence for which kind of claim. */
const EVIDENCE: Record<ClaimKind, RegExp> = {
  test: /\b(tests?|vitest|jest|pytest|mocha|playwright|cypress|phpunit|rspec|unittest|ctest|karma|ava|tap)\b/i,
  build: /\b(build|compile|tsc|webpack|rollup|esbuild|vite|msbuild|gradlew?|mvn|make|cmake|ninja|javac|electron-builder|electron-vite)\b/i,
  check: /\b(lint|eslint|typecheck|type-check|tsc|mypy|pyright|ruff|flake8|pylint|clippy|vet|biome|check)\b/i
}

const ADV = '(?:(?:now|all|also|still|again|currently|both)\\s+)*'
const CLAIMS: { kind: ClaimKind; re: RegExp }[] = [
  { kind: 'test', re: new RegExp(`\\btests?(?:\\s+suite)?\\s+${ADV}(?:pass(?:es|ed)?|succeed(?:s|ed)?|(?:are|is)\\s+${ADV}(?:passing|green)|ran\\s+(?:clean|green|successfully))(?![\\w-])`, 'gi') },
  { kind: 'build', re: new RegExp(`\\bbuild\\s+${ADV}(?:pass(?:es|ed)?|succeed(?:s|ed)?|works|(?:is|was)\\s+${ADV}(?:green|clean|successful|passing)|completed\\s+successfully)(?![\\w-])`, 'gi') },
  { kind: 'build', re: new RegExp(`\\b(?:builds|compiles)\\s+${ADV}(?:successfully|cleanly|fine|without\\s+(?:any\\s+)?errors)(?![\\w-])`, 'gi') },
  { kind: 'check', re: new RegExp(`\\b(?:lint(?:ing|er)?|type\\s?-?check(?:ing|s)?|tsc|eslint)\\s+${ADV}(?:pass(?:es|ed)?|succeed(?:s|ed)?|(?:is|are|was)\\s+${ADV}clean|runs?\\s+clean|reports?\\s+no\\s+errors)(?![\\w-])`, 'gi') },
  { kind: 'check', re: /\bno\s+(?:type|typescript|lint|linter|eslint)\s+errors(?![\w-])/gi }
]

/** Words earlier in the same sentence that turn a match into a condition, a plan or a negation instead of a claim. */
const NOT_A_CLAIM = /(?:\b(?:if|once|when|until|whether|unless|ensure|ensures|ensuring|sure|verify|check|confirm|expect|expecting|hope|hopefully|should|must|will|would|could|might|not|never|cannot|none|nor|untested|unverified)\b|n't\b)[^.!?\n;:]{0,60}$/i

/** Words in the same sentence that make it a mixed or partial report instead of a claim of success. */
const MIXED = /\bfail(?:s|ed|ing|ure|ures)?\b|\bexcept\b|\b\d+\s+(?:out\s+)?of\s+\d+\b/i

/** Prose only: code blocks and inline code are output or examples, not statements by the agent. */
function prose(text: string): string {
  return text.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ')
}

/** The verification claims a reply makes ("tests pass", "the build succeeds", "no type errors"), one per kind. */
export function findClaims(text: string): { kind: ClaimKind; quote: string }[] {
  const t = prose(text)
  const out: { kind: ClaimKind; quote: string }[] = []
  for (const { kind, re } of CLAIMS) {
    if (out.some((c) => c.kind === kind)) continue
    re.lastIndex = 0
    for (let m = re.exec(t); m; m = re.exec(t)) {
      // the sentence so far: a claim only counts when nothing before it makes it conditional or negative
      const before = t.slice(Math.max(0, m.index - 80), m.index).split(/[.!?\n;:]/).pop() ?? ''
      if (NOT_A_CLAIM.test(before)) continue
      // an honest mixed report ("3 tests passed, 2 failed", "4 of 6 tests pass") is not a claim of success
      const rest = t.slice(m.index + m[0].length, m.index + m[0].length + 80).split(/[.!?\n;]/)[0]
      if (MIXED.test(before) || MIXED.test(rest)) continue
      out.push({ kind, quote: m[0].replace(/\s+/g, ' ').trim() })
      break
    }
  }
  return out
}

/** Claims in a reply that no command of this task supports: nothing of that kind ran, or the last one failed. */
export function unsupportedClaims(text: string, commands: RanCommand[]): Unsupported[] {
  const out: Unsupported[] = []
  for (const c of findClaims(text)) {
    const last = [...commands].reverse().find((x) => EVIDENCE[c.kind].test(x.command))
    if (!last) out.push({ ...c, why: 'not_run' })
    else if (last.exitCode !== 0) out.push({ ...c, why: 'failed', command: last.command, exitCode: last.exitCode })
  }
  return out
}

const KIND_WORD: Record<ClaimKind, string> = { test: 'test', build: 'build', check: 'lint or type check' }

/** One line per unsupported claim, in plain words (used both for the model and for the note the user sees). */
export function describeUnsupported(u: Unsupported): string {
  return u.why === 'not_run'
    ? `"${u.quote}": no ${KIND_WORD[u.kind]} command ran in this task`
    : `"${u.quote}": the last ${KIND_WORD[u.kind]} command (${(u.command ?? '').slice(0, 120)}) ended with exit code ${u.exitCode ?? 'unknown'}`
}

/** Files a reply says it created or wrote, taken only from backticked paths so ordinary words are never mistaken for files. */
export function claimedFiles(text: string): string[] {
  const t = text.replace(/```[\s\S]*?(?:```|$)/g, ' ')
  const out = new Set<string>()
  // the rest of the sentence; a backticked span is taken whole, so the dot in `src/app.ts` does not end it
  const re = /\b(?:created?|creating|wrote|written|saved|generated|scaffolded)\b((?:`[^`\n]*`|[^.!?\n`]){0,160})/gi
  for (let m = re.exec(t); m; m = re.exec(t)) {
    for (const p of m[1].matchAll(/`([^`\s*?<>|"]+\.[A-Za-z0-9]{1,8})`/g)) {
      const f = p[1].replace(/\\/g, '/').replace(/^\.\//, '')
      // not a URL, not a version or a method call, not outside the project
      if (/^[a-z]+:\/\//i.test(f) || /^\d/.test(f.split('/').pop() ?? '') || f.includes('..') || /[()]/.test(f)) continue
      out.add(f)
    }
  }
  return [...out]
}

/**
 * Files the reply claims to have created that are not there. `exists` answers for a project-relative path; a bare
 * file name also counts as present when a file changed in this task has that name.
 */
export async function missingClaimedFiles(text: string, changed: string[], exists: (rel: string) => Promise<boolean>): Promise<string[]> {
  const names = new Set(changed.map((c) => c.replace(/\\/g, '/').split('/').pop()!.toLowerCase()))
  const out: string[] = []
  for (const f of claimedFiles(text)) {
    if (!f.includes('/') && names.has(f.toLowerCase())) continue
    if (!(await exists(f))) out.push(f)
  }
  return out
}

/** The message sent back to the model once, so it can run the check or correct its statement. */
export function evidenceNudge(unsupported: Unsupported[], missing: string[]): string {
  const lines = [
    ...unsupported.map((u) => `- ${describeUnsupported(u)}.`),
    ...missing.map((f) => `- You said you created \`${f}\`, but that file does not exist in the project.`)
  ]
  return `Your reply states results that this task has no evidence for:\n${lines.join('\n')}\nDo not repeat a claim without evidence. Either do it now (run the command, write the file) and report the real result, or correct your reply and say plainly what was not done or not verified.`
}

/** The note shown to the user when a reply still makes a claim without evidence after the model was asked once. */
export function evidenceNote(unsupported: Unsupported[], missing: string[]): string {
  const parts = [...unsupported.map(describeUnsupported), ...missing.map((f) => `"${f}" is mentioned as created but does not exist`)]
  return `Not verified by Dahl Studio: ${parts.join('; ')}.`
}

/** Key for "this agent has seen this file": per agent, because a sub-agent has not read what the lead read. */
export const seenKey = (agentId: string, fileKey: string): string => `${agentId}\u0000${fileKey}`

/** The refusal for changing a file that was changed on disk (by a command, another agent or the user) after the agent read it. */
export function changedRefusal(tool: string, rel: string): string {
  return `${rel} changed on disk after you last read it. Read it again with read_file, then call ${tool} again with the current content.`
}

/** The refusal for changing an existing file that the agent has not read in this task. */
export function unreadRefusal(tool: string, rel: string): string {
  return `${rel} already exists and you have not read it in this task. Read it with read_file first, then call ${tool} again${tool === 'edit_file' ? ' with old_string copied exactly from what you read' : ''}.`
}
