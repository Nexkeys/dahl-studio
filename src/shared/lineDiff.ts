// Line counts for the "+N -M" changes pill: how many lines a file gained and lost between two versions.
// No runtime imports, so main, renderer and tests share it.

export interface FileChange {
  path: string
  added: number
  removed: number
  /** the file did not exist before the turn */
  created: boolean
  /** line counts were skipped (file too large or binary) */
  skipped?: boolean
}

/** Lines added and removed (a longest-common-subsequence diff; very large middles fall back to a line multiset). */
export function countLineChanges(before: string, after: string): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 }
  const a = before ? before.replace(/\r\n/g, '\n').split('\n') : []
  const b = after ? after.replace(/\r\n/g, '\n').split('\n') : []
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let ea = a.length, eb = b.length
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) (ea--, eb--)
  const x = a.slice(s, ea), y = b.slice(s, eb)
  let common = 0
  if (x.length * y.length <= 4_000_000) {
    let prev = new Int32Array(y.length + 1), cur = new Int32Array(y.length + 1)
    for (let i = 1; i <= x.length; i++) {
      for (let j = 1; j <= y.length; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
      ;[prev, cur] = [cur, prev]
    }
    common = prev[y.length]
  } else {
    const count = new Map<string, number>()
    for (const l of x) count.set(l, (count.get(l) ?? 0) + 1)
    for (const l of y) {
      const n = count.get(l) ?? 0
      if (n > 0) (common++, count.set(l, n - 1))
    }
  }
  return { added: y.length - common, removed: x.length - common }
}

export function totalChanges(files: FileChange[]): { added: number; removed: number; counted: boolean } {
  return { added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0), counted: files.some((f) => !f.skipped) }
}
