import { describe, it, expect } from 'vitest'
import { budgetContext, buildPrompt, formatFim, pickStrategy, PROMPT_TOKENS, CHARS_PER_TOKEN } from '../src/main/completion/prompt'
import { cleanCompletion, stripFences } from '../src/main/completion/clean'
import { allowsMultiline, composeInline, isFastCompletionModel } from '../src/shared/completion'

const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} line ${i} with some code();`).join('\n')

describe('Tab completions: prompt budget', () => {
  it('keeps about 80% before the cursor and 20% after, cut at line boundaries', () => {
    const prefix = lines(400, 'before') + '\nconst x = '
    const suffix = ';\n' + lines(400, 'after')
    const b = budgetContext(prefix, suffix)
    const total = PROMPT_TOKENS * CHARS_PER_TOKEN
    expect(b.prefix.length + b.suffix.length).toBeLessThanOrEqual(total)
    expect(b.prefix.length).toBeGreaterThan(total * 0.75)
    expect(b.suffix.length).toBeLessThanOrEqual(total * 0.2)
    expect(b.suffix.length).toBeGreaterThan(total * 0.15)
    // the cursor side is never cut, the far side starts and ends on whole lines
    expect(b.prefix.endsWith('const x = ')).toBe(true)
    expect(b.prefix.startsWith('before line')).toBe(true)
    expect(b.suffix.startsWith(';\nafter line 0')).toBe(true)
    expect(b.suffix.endsWith('code();')).toBe(true)
  })

  it('gives room one side does not need to the other', () => {
    const long = lines(400, 'x')
    const shortSuffix = budgetContext(long, '\n}')
    expect(shortSuffix.suffix).toBe('\n}')
    expect(shortSuffix.prefix.length).toBeGreaterThan(PROMPT_TOKENS * CHARS_PER_TOKEN * 0.95)
    const shortPrefix = budgetContext('let a = ', long)
    expect(shortPrefix.prefix).toBe('let a = ')
    expect(shortPrefix.suffix.length).toBeGreaterThan(PROMPT_TOKENS * CHARS_PER_TOKEN * 0.9)
  })
})

describe('Tab completions: FIM formats and strategy per model family', () => {
  it('formats Qwen2.5-Coder, DeepSeek-Coder and StarCoder prompts with their own tokens', () => {
    expect(formatFim('qwen', 'A', 'B')).toBe('<|fim_prefix|>A<|fim_suffix|>B<|fim_middle|>')
    // DeepSeek-Coder model card: fullwidth vertical line (U+FF5C) and U+2581
    expect(formatFim('deepseek', 'A', 'B')).toBe('<｜fim▁begin｜>A<｜fim▁hole｜>B<｜fim▁end｜>')
    expect(formatFim('starcoder', 'A', 'B')).toBe('<fim_prefix>A<fim_suffix>B<fim_middle>')
  })

  it('uses FIM only where the server and model support it, the hole filler elsewhere', () => {
    expect(pickStrategy('mistral:codestral-latest')).toEqual({ kind: 'mistral-fim' })
    expect(pickStrategy('ollama:qwen2.5-coder:1.5b')).toEqual({ kind: 'suffix-fim' })
    expect(pickStrategy('lmstudio:deepseek-coder-6.7b-base')).toEqual({ kind: 'raw-fim', family: 'deepseek' })
    expect(pickStrategy('lmstudio:qwen2.5-coder-7b')).toEqual({ kind: 'raw-fim', family: 'qwen' })
    expect(pickStrategy('ollama:llama3.2')).toEqual({ kind: 'chat' })
    expect(pickStrategy('groq:llama-3.1-8b-instant')).toEqual({ kind: 'chat' })
    expect(pickStrategy('nvidia:qwen/qwen2.5-coder-32b-instruct')).toEqual({ kind: 'chat' })
    expect(pickStrategy('dahl:deepseek-ai/DeepSeek-V4-Flash-0731')).toEqual({ kind: 'chat' })
    expect(pickStrategy('ollama:qwen2.5-coder:1.5b', new Set(['ollama:qwen2.5-coder:1.5b']))).toEqual({ kind: 'chat' })
  })

  it('builds a raw FIM prompt with the file name, and stops at the line end when the cursor is mid-line', () => {
    const p = buildPrompt({ path: 'src/a.ts', language: 'typescript', prefix: 'const x = ', suffix: 'foo\n' }, pickStrategy('lmstudio:qwen2.5-coder-7b'), 'qwen2.5-coder-7b')
    expect(p.singleLine).toBe(true)
    expect(p.prompt).toBe('<|fim_prefix|>// Path: src/a.ts\nconst x = <|fim_suffix|>foo\n<|fim_middle|>')
    expect(p.stop[0]).toBe('\n')
    expect(p.stop.length).toBeLessThanOrEqual(4)
    expect(p.temperature).toBeLessThanOrEqual(0.2)
    expect(p.maxTokens).toBeLessThanOrEqual(64)
  })

  it('builds the hole-filler chat prompt with the file name, language and a few lines of another open tab', () => {
    const p = buildPrompt({ path: 'src/b.py', language: 'python', prefix: 'def add(a, b):\n    ', suffix: '\n', related: [{ path: 'src/util.py', text: 'import math' }] }, { kind: 'chat' })
    expect(p.singleLine).toBe(false)
    expect(p.stop).toEqual(['</COMPLETION>'])
    const last = String(p.messages!.at(-1)!.content)
    expect(last).toContain('<FILE path="src/b.py" language="python">\ndef add(a, b):\n    {{FILL_HERE}}\n')
    expect(last).toContain('<OPEN_TAB path="src/util.py">\nimport math')
    expect(p.messages![0].role).toBe('system')
  })
})

describe('Tab completions: answer cleaning', () => {
  const ctx = (prefix: string, suffix: string) => ({ prefix, suffix, singleLine: !allowsMultiline(suffix.split('\n')[0]) })

  it('strips code fences and tags', () => {
    expect(stripFences('```ts\nfoo()\n```')).toBe('foo()')
    expect(stripFences('```\nfoo()\n```\nThis calls foo.')).toBe('foo()')
    expect(cleanCompletion('<COMPLETION>```js\na + b\n```</COMPLETION>', ctx('return ', '\n'))).toBe('a + b')
    expect(cleanCompletion('a + b<|endoftext|>', ctx('return ', '\n'))).toBe('a + b')
    expect(cleanCompletion('<think>hmm</think>a + b', ctx('return ', '\n'))).toBe('a + b')
  })

  it('removes the closing brace the editor already inserted and keeps the line break before it', () => {
    const text = cleanCompletion('<COMPLETION>\n  return a + b\n}</COMPLETION>', ctx('function add(a, b) {', '}\n'))
    expect(text).toBe('\n  return a + b\n')
    expect(composeInline(text, '}')).toEqual({ insertText: '\n  return a + b\n}', replaceRest: true })
  })

  it('keeps a bracket the answer opened itself, drops one that repeats the suffix', () => {
    expect(cleanCompletion('f(y)', ctx('print(', ')'))).toBe('f(y)')
    expect(cleanCompletion('"hi")', ctx('print(', ')'))).toBe('"hi"')
    expect(cleanCompletion('foo(bar);', ctx('  x = ', ';'))).toBe('foo(bar)')
  })

  it('stops where the answer reaches code that already follows the cursor', () => {
    expect(cleanCompletion('\n  const x = 1\n  return 2\n}', ctx('function a() {', '\n  return 2\n}'))).toBe('\n  const x = 1')
    // an inner block's closing brace at another indentation is not the suffix line
    expect(cleanCompletion('\n  if (a) {\n    b()\n  }', ctx('function a() {', '\n}'))).toBe('\n  if (a) {\n    b()\n  }')
  })

  it('trims trailing whitespace and drops text repeated from the line', () => {
    expect(cleanCompletion('foo()   \n  bar()  \n\n', ctx('', '\n'))).toBe('foo()\n  bar()')
    expect(cleanCompletion('const total = a + b', ctx('  const total = ', '\n'))).toBe('a + b')
    expect(cleanCompletion('return x', ctx('  ret', '\n'))).toBe('urn x')
  })

  it('stays on one line in the middle of other text, and never writes em or en dashes', () => {
    expect(cleanCompletion('a, b\nmore()', ctx('call(', 'c)'))).toBe('a, b')
    expect(cleanCompletion('\nnext()', ctx('call(', 'c)'))).toBe('')
    expect(cleanCompletion('x // fast — cached', ctx('y = ', '\n'))).not.toMatch(/[–—]/)
  })

  it('suggests fast models for completions and never reasoning models', () => {
    expect(isFastCompletionModel('groq:llama-3.1-8b-instant')).toBe(true)
    expect(isFastCompletionModel('ollama:qwen2.5-coder:1.5b')).toBe(true)
    expect(isFastCompletionModel('gemini:gemini-2.5-flash')).toBe(true)
    expect(isFastCompletionModel('openai:gpt-4o-mini')).toBe(true)
    expect(isFastCompletionModel('dahl:zai-org/GLM-5.3-Flash')).toBe(true)
    expect(isFastCompletionModel('dahl:MiniMaxAI/MiniMax-M2.7')).toBe(false)
    expect(isFastCompletionModel('openai:o3-mini')).toBe(false)
    expect(isFastCompletionModel('anthropic:claude-opus-4-1')).toBe(false)
  })
})
