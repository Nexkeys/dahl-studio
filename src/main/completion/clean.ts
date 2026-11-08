import { lineBefore } from '@shared/completion'
import { stripDashes } from '@shared/dashes'

// Cleans a model's answer into the text to show as ghost text. Models add fences and tags, repeat what is already
// before the cursor, or keep writing the code that follows it; each step below removes one of those habits.

/** FIM control tokens that leak into answers (Qwen/StarCoder style, and DeepSeek's fullwidth-bar tokens). */
const SPECIAL = /<\|(?:fim_[a-z]+|endoftext|file_sep|repo_name|im_start|im_end|EOT)\|>|<｜[^｜>]{1,40}｜>|<\/?(?:fim_[a-z]+|file_sep)>/g
export const MAX_LINES = 16

export interface CleanContext {
  /** budgeted text before and after the cursor */
  prefix: string
  suffix: string
  singleLine: boolean
  maxLines?: number
}

/** A fenced answer (```lang ... ```) becomes its content; any chatter after the closing fence goes too. */
export function stripFences(s: string): string {
  const open = /^\s*```[\w+#.-]*[ \t]*\n/.exec(s)
  if (!open) return s
  const body = s.slice(open[0].length)
  const close = body.search(/\n?```[ \t]*(\n[\s\S]*)?$/)
  return close >= 0 ? body.slice(0, close) : body
}

/** Chat models often start with what is already on the line: the whole line, or the word being typed. */
function dropRepeatedLineStart(s: string, before: string): string {
  const typed = before.trimStart()
  if (typed.length >= 2) {
    if (s.startsWith(before)) return s.slice(before.length)
    const t = s.replace(/^[ \t]+/, '')
    if (t.startsWith(typed)) return t.slice(typed.length)
  }
  const word = /[A-Za-z_$][\w$]*$/.exec(before)?.[0]
  return word && word.length >= 2 && s.startsWith(word) ? s.slice(word.length) : s
}

/** Cut where the answer reaches the first line that already follows the cursor (compared with indentation). */
function cutAtSuffixLine(s: string, suffix: string): string {
  const anchor = suffix.split('\n').slice(1).find((l) => l.trim())?.trimEnd()
  if (!anchor) return s
  const lines = s.split('\n')
  for (let i = 1; i < lines.length; i++) if (lines[i].trimEnd() === anchor) return lines.slice(0, i).join('\n')
  return s
}

function netClosing(s: string): number {
  let n = 0
  for (const ch of s) n += ')]}'.includes(ch) ? 1 : '([{'.includes(ch) ? -1 : 0
  return n
}

/**
 * Remove the end of the answer when it repeats the start of the suffix (`foo(|)` answered with `"x")`). A closing
 * bracket the answer opened itself is kept: `print(|)` answered with `f(y)` stays `f(y)`.
 */
export function dropSuffixOverlap(s: string, suffix: string): string {
  for (let k = Math.min(s.length, suffix.length, 400); k > 0; k--) {
    const ov = suffix.slice(0, k)
    if (!ov.trim() || !s.endsWith(ov)) continue
    const closers = [...ov].filter((c) => ')]}'.includes(c)).length
    if (closers > netClosing(s)) continue
    return s.slice(0, s.length - k)
  }
  return s
}

export function cleanCompletion(raw: string, ctx: CleanContext): string {
  let s = raw.replace(/\r\n/g, '\n')
  s = s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
  const open = s.indexOf('<COMPLETION>')
  if (open >= 0) s = s.slice(open + '<COMPLETION>'.length)
  const close = s.indexOf('</COMPLETION>')
  if (close >= 0) s = s.slice(0, close)
  s = stripFences(s.replace(SPECIAL, '')).trimEnd()
  s = dropRepeatedLineStart(s, lineBefore(ctx.prefix))
  s = cutAtSuffixLine(s, ctx.suffix).trimEnd()
  s = dropSuffixOverlap(s, ctx.suffix)
  // trailing spaces on every line; a final line break before the suffix (`{|}` -> "\n  body\n" + "}") stays
  s = s.replace(/[ \t]+(?=\n|$)/g, '')
  // the cursor is in the middle of other text: the suggestion stays on this line
  if (ctx.singleLine) s = s.split('\n')[0]
  const lines = s.split('\n')
  if (lines.length > (ctx.maxLines ?? MAX_LINES)) s = lines.slice(0, ctx.maxLines ?? MAX_LINES).join('\n')
  s = stripDashes(s)
  return s.trim() ? s : ''
}
