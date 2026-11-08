// A small YAML frontmatter reader for SKILL.md and .cursor/rules/*.mdc files. It covers what these files use:
// "key: value" scalars (plain, single or double quoted), booleans, block scalars (| and >), lists ("- item" or
// [a, b]) and one level of nested maps (metadata:). Anything fancier is reported as an error, never guessed.

export type FmValue = string | boolean | number | string[] | Record<string, string>
export interface Frontmatter {
  data: Record<string, FmValue>
  body: string
  /** set when the file starts with --- but the block is malformed */
  error?: string
  /** false when the file has no frontmatter block at all */
  present: boolean
}

function unquote(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v) as string
    } catch {
      return v.slice(1, -1)
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
  // a plain scalar may carry a trailing comment
  return v.replace(/\s+#.*$/, '')
}

function scalar(raw: string): FmValue {
  const v = raw.trim()
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true'
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (v.startsWith('[') && v.endsWith(']'))
    return v.slice(1, -1).split(',').map((s) => unquote(s)).filter((s) => s.length > 0)
  return unquote(v)
}

/** Split a document into frontmatter data and body. Line endings may be CRLF. */
export function parseFrontmatter(text: string): Frontmatter {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!src.startsWith('---\n') && src.trim() !== '---') return { data: {}, body: src, present: false }
  const end = src.indexOf('\n---', 3)
  if (end < 0) return { data: {}, body: src, present: true, error: 'frontmatter is not closed with ---' }
  const block = src.slice(4, end)
  const after = src.slice(end + 4)
  const body = after.startsWith('\n') ? after.slice(1) : after.replace(/^[^\n]*\n?/, '')
  const data: Record<string, FmValue> = {}
  const lines = block.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const m = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line)
    if (!m) return { data, body, present: true, error: `cannot read frontmatter line ${i + 2}: "${line.slice(0, 60)}"` }
    const key = m[1]
    const rest = m[2].trim()
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const parts: string[] = []
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) parts.push(lines[++i].trim())
      data[key] = rest.startsWith('|') ? parts.join('\n').trim() : parts.join(' ').replace(/\s+/g, ' ').trim()
      continue
    }
    if (rest) {
      data[key] = scalar(rest)
      continue
    }
    // an empty value: a following indented block is a list or a nested map
    const items: string[] = []
    const map: Record<string, string> = {}
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || /^-\s/.test(lines[i + 1]))) {
      const sub = lines[++i].trim()
      if (sub.startsWith('#')) continue
      if (sub.startsWith('- ')) items.push(unquote(sub.slice(2)))
      else {
        const kv = /^([\w.-]+)\s*:(.*)$/.exec(sub)
        if (!kv) return { data, body, present: true, error: `cannot read "${key}" entry: "${sub.slice(0, 60)}"` }
        map[kv[1]] = unquote(kv[2])
      }
    }
    data[key] = items.length ? items : Object.keys(map).length ? map : ''
  }
  return { data, body, present: true }
}
