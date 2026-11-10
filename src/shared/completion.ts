// Tab completions: small text helpers shared by the main process (prompt and answer cleaning) and the editor provider.

/** Text after the cursor on the cursor's line. */
export function lineRest(suffix: string): string {
  const nl = suffix.indexOf('\n')
  return (nl < 0 ? suffix : suffix.slice(0, nl)).replace(/\r$/, '')
}

/** Text before the cursor on the cursor's line. */
export function lineBefore(prefix: string): string {
  return prefix.slice(prefix.lastIndexOf('\n') + 1)
}

/**
 * A multi-line suggestion only makes sense at the end of a line, or before closing brackets and quotes the editor
 * inserted on its own (`foo(|)`, `{|}`). In the middle of other text, the suggestion stays on the cursor's line.
 */
export function allowsMultiline(rest: string): boolean {
  return /^[\s)\]}>"'`;,]*$/.test(rest)
}

/**
 * Turns a cleaned suggestion into the inline item. Before closers, the item replaces the rest of the line and ends
 * with it (Monaco needs a multi-line item to end at the end of a line); elsewhere it is inserted at the cursor.
 */
export function composeInline(text: string, rest: string): { insertText: string; replaceRest: boolean } {
  if (rest && allowsMultiline(rest)) return { insertText: text + rest, replaceRest: true }
  return { insertText: text, replaceRest: false }
}

/** Fast enough for completions: local coder models, Groq, Codestral and small tiers (flash, mini, haiku). Never reasoning models. */
export function isFastCompletionModel(key: string): boolean {
  const sep = key.indexOf(':')
  const provider = sep > 0 ? key.slice(0, sep) : ''
  const id = key.slice(sep + 1).toLowerCase()
  if (/(^|[-_/.])(o\d|r1|reason|reasoning|thinking)([-_/.]|$)/.test(id) || /(embed|whisper|tts|audio|image|guard|vision)/.test(id)) return false
  if (provider === 'ollama' || provider === 'lmstudio') return /(coder|codestral|starcoder|codegemma|code)/.test(id)
  if (provider === 'groq' || provider === 'fake') return true
  // whole name parts only: "gpt-4o-mini" and "gemini-2.5-flash" are fast tiers, "MiniMax-M2.7" is not
  return id.includes('codestral') || /(^|[-_/.:])(flash|haiku|mini|lite|instant)([-_/.:]|$)/.test(id)
}
