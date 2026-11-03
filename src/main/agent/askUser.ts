import type { AskQuestion } from '@shared/types'
import { stripDashes } from '@shared/dashes'
import type { ExecCtx, ToolResult } from './toolExec'

const clean = (v: unknown, max: number): string => stripDashes(String(v ?? '')).replace(/\s+/g, ' ').trim().slice(0, max)

/** Turn the model's arguments into at most 4 questions with 2 to 5 options each; anything malformed is dropped. */
export function parseQuestions(raw: unknown): AskQuestion[] {
  const list = Array.isArray(raw) ? raw.slice(0, 4) : []
  return list
    .map((q): AskQuestion => {
      const o = (q ?? {}) as Record<string, unknown>
      const options = (Array.isArray(o.options) ? o.options : []).slice(0, 5)
        .map((x) => (typeof x === 'string' ? { label: clean(x, 80) } : { label: clean((x as Record<string, unknown>)?.label, 80), description: clean((x as Record<string, unknown>)?.description, 220) || undefined }))
        .filter((x) => x.label)
      return { question: clean(o.question, 300), header: clean(o.header, 24) || undefined, multiSelect: !!o.multiSelect, options }
    })
    .filter((q) => q.question && q.options.length >= 2)
}

/** ask_user: show the questions in the chat and wait. Answers arrive as JSON (question index -> answer text). */
export async function execAskUser(c: ExecCtx, a: Record<string, unknown>): Promise<ToolResult> {
  const questions = parseQuestions(a.questions)
  if (!questions.length) return { ok: false, text: 'ask_user needs 1 to 4 questions, each with a question and at least 2 options.' }
  const d = await c.approve({ kind: 'question', agent: c.agentName, questions })
  if (!d.approved) return { ok: true, text: `The user skipped the questions${d.feedback ? ` and said: ${d.feedback}` : ''}. Continue with your best judgment and say which assumptions you made.` }
  let answers: Record<string, string> = {}
  try {
    answers = JSON.parse(d.feedback ?? '{}') as Record<string, string>
  } catch {
    answers = {}
  }
  return { ok: true, text: `The user answered:\n${questions.map((q, i) => `${i + 1}. ${q.question}\n   Answer: ${answers[String(i)] || '(no answer)'}`).join('\n')}` }
}
