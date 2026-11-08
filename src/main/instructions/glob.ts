// Glob matching for Cursor rule "globs": ** crosses folders, * and ? stay inside one, {a,b} alternates, [..] is a
// class. A pattern without a slash matches the file name at any depth (like .gitignore), so "*.tsx" matches
// "src/ui/App.tsx".

function toRegex(glob: string): RegExp {
  let re = ''
  let i = 0
  let depth = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches zero or more folders; a trailing "**" matches everything below
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 3
        } else {
          re += '.*'
          i += 2
        }
        continue
      }
      re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      re += '(?:'
      depth++
    } else if (c === '}' && depth > 0) {
      re += ')'
      depth--
    } else if (c === ',' && depth > 0) re += '|'
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1)
      if (end < 0) re += '\\['
      else {
        re += `[${glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else re += /[.+^$()|\\]/.test(c) ? `\\${c}` : c
    i++
  }
  return new RegExp(`^${re}$`, 'i')
}

const cache = new Map<string, RegExp>()

/** True when the project-relative path (forward slashes) matches the glob. */
export function matchGlob(glob: string, rel: string): boolean {
  const g = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '')
  if (!g) return false
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '')
  let re = cache.get(g)
  if (!re) cache.set(g, (re = toRegex(g.includes('/') ? g : `**/${g}`)))
  return re.test(p)
}

/** Cursor writes globs as one comma separated string or as a list. Commas inside {} belong to the pattern. */
export function splitGlobs(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean)
  if (typeof v !== 'string') return []
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (const c of v) {
    if (c === '{') depth++
    if (c === '}') depth = Math.max(0, depth - 1)
    if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
}
