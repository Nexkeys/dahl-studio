import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { PlanStep, RunState, TurnSummary } from '@shared/types'
import { atomicWrite } from '../util'

/**
 * App-maintained PROGRESS.md in the project root: a durable work log that gives every model (especially weaker
 * ones) the objective, plan, history and next steps. Dahl Studio only rewrites its own marked sections, so text
 * the user writes elsewhere in the file is preserved.
 */
export const PROGRESS_FILE = 'PROGRESS.md'
const MAX_BYTES = 80_000

const HEADER = `# Progress

This file is maintained by Dahl Studio. It records the current task, the plan and a log of every task, so work can
continue reliably across sessions and models. You can add your own notes outside the marked sections.
`

function section(name: string, body: string): string {
  return `<!-- dahl:${name} -->\n${body.trim()}\n<!-- /dahl:${name} -->`
}

function replaceSection(doc: string, name: string, body: string): string {
  const re = new RegExp(`<!-- dahl:${name} -->[\\s\\S]*?<!-- /dahl:${name} -->`)
  return re.test(doc) ? doc.replace(re, section(name, body)) : `${doc.trimEnd()}\n\n${section(name, body)}\n`
}

async function read(root: string): Promise<string> {
  try {
    return await fs.readFile(path.join(root, PROGRESS_FILE), 'utf8')
  } catch {
    return HEADER
  }
}

export async function readProgress(root: string, maxChars = 7000): Promise<string> {
  const doc = await read(root)
  if (doc === HEADER) return ''
  return doc.length > maxChars ? `[earlier entries omitted]\n${doc.slice(-maxChars)}` : doc
}

export async function progressStart(root: string, run: RunState, prompt: string): Promise<void> {
  let doc = await read(root)
  doc = replaceSection(doc, 'current', `## Current task\n- Status: in progress\n- Started: ${new Date().toLocaleString()}\n- Mode: ${run.mode} | Model: ${run.model} | Thinking: ${run.thinking}\n- Request: ${oneLine(prompt, 600)}`)
  if (!/<!-- dahl:plan -->/.test(doc)) doc = replaceSection(doc, 'plan', '## Plan\n(no plan yet)')
  if (!/<!-- dahl:log -->/.test(doc)) doc = replaceSection(doc, 'log', '## Task log')
  await atomicWrite(path.join(root, PROGRESS_FILE), doc)
}

export async function progressPlan(root: string, steps: PlanStep[]): Promise<void> {
  const mark: Record<PlanStep['status'], string> = { done: '[x]', in_progress: '[~]', pending: '[ ]', failed: '[!]' }
  const body = `## Plan\n${steps.map((s) => `- ${mark[s.status]} ${s.title}`).join('\n') || '(no plan yet)'}`
  await atomicWrite(path.join(root, PROGRESS_FILE), replaceSection(await read(root), 'plan', body))
}

export async function progressFinish(root: string, o: { run: RunState; prompt: string; status: string; answer: string; summary: TurnSummary; error?: string }): Promise<void> {
  let doc = await read(root)
  const s = o.summary
  const remaining = o.run.plan.filter((p) => p.status !== 'done')
  const entry = [
    `### ${new Date().toLocaleString()} | ${o.status} | ${o.run.mode} | ${o.run.model}`,
    `**Request:** ${oneLine(o.prompt, 800)}`,
    o.answer ? `**Result:** ${o.answer.trim().slice(0, 1800)}` : '',
    s.changedFiles.length ? `**Files changed:** ${s.changedFiles.join(', ')}` : '**Files changed:** none',
    s.commands.length ? `**Commands:**\n${s.commands.map((c) => `- \`${oneLine(c.command, 200)}\` (exit ${c.exitCode ?? 'n/a'})`).join('\n')}` : '**Verification:** no commands were run',
    o.error ? `**Error:** ${oneLine(o.error, 600)}` : '',
    remaining.length ? `**Next steps:**\n${remaining.map((p) => `- ${p.title}`).join('\n')}` : '',
    `_${s.toolCount} tool calls, ${Math.round(s.durationMs / 1000)}s, ${s.memoriesSaved} memories saved_`
  ].filter(Boolean).join('\n\n')
  const logRe = /<!-- dahl:log -->([\s\S]*?)<!-- \/dahl:log -->/
  const m = logRe.exec(doc)
  const prev = (m?.[1] ?? '## Task log').trim()
  doc = replaceSection(doc, 'log', `${prev}\n\n${entry}`)
  doc = replaceSection(doc, 'current', `## Current task\n- Status: ${o.status}${o.status === 'completed' ? '' : ' (send "Continue" to resume)'}\n- Last request: ${oneLine(o.prompt, 400)}`)
  // keep the file bounded: move the oldest log entries to .dahl/progress-archive.md
  if (Buffer.byteLength(doc) > MAX_BYTES) {
    const lm = logRe.exec(doc)
    if (lm) {
      const entries = lm[1].split(/\n(?=### )/)
      const keep = entries.slice(-15)
      const old = entries.slice(1, -15)
      if (old.length) await fs.appendFile(path.join(root, '.dahl', 'progress-archive.md'), old.join('\n') + '\n').catch(() => {})
      doc = replaceSection(doc, 'log', ['## Task log', '(older entries: .dahl/progress-archive.md)', ...keep.filter((e) => e.startsWith('### '))].join('\n\n'))
    }
  }
  await atomicWrite(path.join(root, PROGRESS_FILE), doc)
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '...' : t
}
