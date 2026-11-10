import type { ChatMessage, CompletionRequest } from '@shared/types'
import { allowsMultiline, lineRest } from '@shared/completion'

// Prompt building for Tab completions. Budget defaults follow Continue: about 1024 prompt tokens, 20% of the room
// for the text after the cursor. Tokens are estimated as characters / 4, like the rest of the app.

export const PROMPT_TOKENS = 1024
export const SUFFIX_SHARE = 0.2
export const CHARS_PER_TOKEN = 4
/** short answers keep completions fast and cheap */
export const MAX_TOKENS = { multi: 160, single: 48 }
export const TEMPERATURE = 0.1
/** context from other open tabs: at most this many characters in all, only for the chat prompt */
export const RELATED_CHARS = 800

export type FimFamily = 'qwen' | 'deepseek' | 'starcoder' | 'codestral'
export type Strategy =
  | { kind: 'fake' } // smoke and dev runs only
  | { kind: 'mistral-fim' } // Codestral: POST /v1/fim/completions with prompt and suffix
  | { kind: 'suffix-fim' } // Ollama /v1/completions with suffix: the server applies the model's own FIM template
  | { kind: 'raw-fim'; family: Exclude<FimFamily, 'codestral'> } // /v1/completions with the model's FIM tokens in the prompt
  | { kind: 'chat' } // any chat model: "hole filler" prompt that asks for only the missing code

export function splitKey(key: string): { provider: string; id: string } {
  const sep = key.indexOf(':')
  return sep > 0 ? { provider: key.slice(0, sep), id: key.slice(sep + 1) } : { provider: 'dahl', id: key }
}

/** FIM-trained model families, from the model id. */
export function fimFamily(id: string): FimFamily | null {
  const s = id.toLowerCase()
  if (s.includes('codestral')) return 'codestral'
  if (/qwen[\d.]*[-_ ]?coder/.test(s)) return 'qwen'
  if (/deepseek[-_ ]?coder/.test(s)) return 'deepseek'
  if (s.includes('starcoder')) return 'starcoder'
  return null
}

/** How to ask this model. noFim: models whose server refused a FIM request (they fall back to the chat prompt). */
export function pickStrategy(modelKey: string, noFim?: ReadonlySet<string>): Strategy {
  const { provider, id } = splitKey(modelKey)
  if (provider === 'fake') return { kind: 'fake' }
  const fam = noFim?.has(modelKey) ? null : fimFamily(id)
  if (fam === 'codestral' && provider === 'mistral') return { kind: 'mistral-fim' }
  if (fam && provider === 'ollama') return { kind: 'suffix-fim' }
  if (fam && fam !== 'codestral' && provider === 'lmstudio') return { kind: 'raw-fim', family: fam }
  return { kind: 'chat' }
}

/** The last n characters, starting at a line boundary when cut (a partial first line confuses models). */
function takeTail(s: string, n: number): string {
  if (s.length <= n) return s
  const cut = s.slice(s.length - n)
  const nl = cut.indexOf('\n')
  return nl >= 0 && nl < cut.length - 1 ? cut.slice(nl + 1) : cut
}

/** The first n characters, ending at a line boundary when cut. */
function takeHead(s: string, n: number): string {
  if (s.length <= n) return s
  const cut = s.slice(0, n)
  const nl = cut.lastIndexOf('\n')
  return nl > 0 ? cut.slice(0, nl) : cut
}

/** Fit prefix and suffix into the budget: about 80% before the cursor and 20% after; room one side does not use goes to the other. */
export function budgetContext(prefix: string, suffix: string, tokens = PROMPT_TOKENS, share = SUFFIX_SHARE): { prefix: string; suffix: string } {
  const total = Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN))
  let suffixRoom = Math.floor(total * share)
  let prefixRoom = total - suffixRoom
  if (suffix.length < suffixRoom) {
    prefixRoom += suffixRoom - suffix.length
    suffixRoom = suffix.length
  } else if (prefix.length < prefixRoom) {
    suffixRoom += prefixRoom - prefix.length
    prefixRoom = prefix.length
  }
  return { prefix: takeTail(prefix, prefixRoom), suffix: takeHead(suffix, suffixRoom) }
}

// DeepSeek-Coder FIM tokens, from its model card: fullwidth vertical line U+FF5C and U+2581 in place of underscores.
const DS = { begin: '<｜fim▁begin｜>', hole: '<｜fim▁hole｜>', end: '<｜fim▁end｜>', eos: '<｜end▁of▁sentence｜>' }

export function formatFim(family: Exclude<FimFamily, 'codestral'>, prefix: string, suffix: string): string {
  if (family === 'qwen') return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`
  if (family === 'deepseek') return `${DS.begin}${prefix}${DS.hole}${suffix}${DS.end}`
  return `<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`
}

const FAMILY_STOPS: Record<FimFamily, string[]> = {
  qwen: ['<|endoftext|>', '<|fim_prefix|>', '<|file_sep|>'],
  deepseek: [DS.eos, DS.begin, '<|EOT|>'],
  starcoder: ['<|endoftext|>', '<fim_prefix>', '<file_sep>'],
  codestral: []
}

/** Stop sequences (OpenAI-compatible APIs and Groq accept at most 4). A FIM answer on one line stops at the line break. */
export function stopsFor(strategy: Strategy, family: FimFamily | null, singleLine: boolean): string[] {
  if (strategy.kind === 'chat') return ['</COMPLETION>']
  const own = family ? FAMILY_STOPS[family] : []
  return (singleLine ? ['\n', ...own] : own).slice(0, 4)
}

const LINE_COMMENT: Record<string, string> = {
  typescript: '//', javascript: '//', java: '//', csharp: '//', cpp: '//', c: '//', go: '//', rust: '//', kotlin: '//', swift: '//', dart: '//', php: '//', scss: '//', less: '//',
  python: '#', ruby: '#', shell: '#', powershell: '#', yaml: '#', dockerfile: '#', ini: ';', sql: '--', lua: '--'
}

/** A comment naming the file, put before the prefix for FIM models (they have no other place for it). */
export function pathComment(path: string, language: string): string {
  const c = LINE_COMMENT[language]
  return c ? `${c} Path: ${path}\n` : ''
}

const HOLE = '{{FILL_HERE}}'
const SYSTEM = [
  'You complete code in an editor. You get a file with one hole, marked {{FILL_HERE}}, where the cursor is.',
  'Reply with only the text that belongs in the hole, inside <COMPLETION></COMPLETION> tags. No explanation, no code fences, and nothing that is already before or after the hole.',
  'Match the indentation of the surrounding code and keep it short: finish the current statement or block. If nothing fits, reply <COMPLETION></COMPLETION>.'
].join('\n')
const EXAMPLE_USER = '<FILE path="geometry.py" language="python">\ndef area(r):\n    return {{FILL_HERE}}\n\nprint(area(2))\n</FILE>\nFill the hole.'
const EXAMPLE_REPLY = '<COMPLETION>3.14159 * r * r</COMPLETION>'

function trimRelated(related: CompletionRequest['related']): { path: string; text: string }[] {
  let room = RELATED_CHARS
  const out: { path: string; text: string }[] = []
  for (const r of (related ?? []).slice(0, 3)) {
    if (room < 80) break
    const text = r.text.length > room ? r.text.slice(0, r.text.lastIndexOf('\n', room) > 0 ? r.text.lastIndexOf('\n', room) : room) : r.text
    room -= text.length
    out.push({ path: r.path, text })
  }
  return out
}

/** "Hole filler" messages for chat-only models. */
export function holeFillerMessages(input: { path: string; language: string; prefix: string; suffix: string; related?: CompletionRequest['related']; singleLine: boolean }): ChatMessage[] {
  const parts = trimRelated(input.related).map((r) => `<OPEN_TAB path="${r.path}">\n${r.text}\n</OPEN_TAB>`)
  parts.push(`<FILE path="${input.path}" language="${input.language}">\n${input.prefix}${HOLE}${input.suffix}\n</FILE>`)
  parts.push(input.singleLine ? 'Fill the hole with the rest of this line only (no line break).' : 'Fill the hole.')
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: EXAMPLE_USER },
    { role: 'assistant', content: EXAMPLE_REPLY },
    { role: 'user', content: parts.join('\n\n') }
  ]
}

export interface BuiltPrompt {
  singleLine: boolean
  /** budgeted text around the cursor (what the answer is cleaned against) */
  prefix: string
  suffix: string
  /** FIM prompt: with the model's tokens (raw-fim), or the file comment and prefix (suffix-fim, mistral-fim) */
  prompt?: string
  messages?: ChatMessage[]
  stop: string[]
  maxTokens: number
  temperature: number
}

export function buildPrompt(req: Pick<CompletionRequest, 'path' | 'language' | 'prefix' | 'suffix' | 'related'>, strategy: Strategy, modelId = ''): BuiltPrompt {
  const singleLine = !allowsMultiline(lineRest(req.suffix))
  const fim = strategy.kind !== 'chat' && strategy.kind !== 'fake'
  const header = fim ? pathComment(req.path, req.language) : `${req.path}${req.language}`
  // the file name and the open-tab lines come out of the same budget (the fixed instructions do not)
  const related = strategy.kind === 'chat' ? trimRelated(req.related) : []
  const extra = header.length + related.reduce((n, r) => n + r.path.length + r.text.length, 0)
  const { prefix, suffix } = budgetContext(req.prefix, req.suffix, PROMPT_TOKENS - Math.ceil(extra / CHARS_PER_TOKEN))
  const out: BuiltPrompt = {
    singleLine, prefix, suffix,
    stop: stopsFor(strategy, fimFamily(modelId), singleLine),
    maxTokens: singleLine ? MAX_TOKENS.single : MAX_TOKENS.multi,
    temperature: TEMPERATURE
  }
  if (strategy.kind === 'raw-fim') out.prompt = formatFim(strategy.family, header + prefix, suffix)
  else if (fim) out.prompt = header + prefix
  else if (strategy.kind === 'chat') out.messages = holeFillerMessages({ ...req, prefix, suffix, related, singleLine })
  return out
}
