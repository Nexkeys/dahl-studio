// Repairs Markdown tables that models break, before display. Seen live (MiniMax): a whole table on one line with rows
// separated by "| |", and a separator row with 2 cells under a 3-column header, so it printed as raw text.
// Only lines that look like tables are touched; code fences are left alone.

const SEP_CELL = /^\s*:?-{2,}:?\s*$/

function cells(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return t.split('|')
}

const row = (c: string[]): string => `| ${c.map((x) => x.trim()).join(' | ')} |`

/** A whole table packed into one line: header, separator run, then rows of the header's width separated by blank cells. */
function unpackLine(line: string): string[] | null {
  if (!/^\s*\|/.test(line) || !/\|\s*:?-{2,}/.test(line)) return null
  const parts = line.trim().split('|').slice(1, -1)
  const firstSep = parts.findIndex((p) => SEP_CELL.test(p))
  if (firstSep < 1) return null
  const header = parts.slice(0, firstSep).filter((p, i, a) => !(i === a.length - 1 && !p.trim()))
  const n = header.length
  if (n < 2) return null
  let i = firstSep
  while (i < parts.length && SEP_CELL.test(parts[i])) i++
  const rest = parts.slice(i)
  if (!rest.some((p) => p.trim())) return [row(header), row(header.map(() => '---'))]
  const rows: string[][] = []
  let k = 0
  while (k < rest.length) {
    while (k < rest.length && !rest[k].trim() && rows.length === 0) k++ // blank boundary before the first row
    if (k >= rest.length) break
    const r = rest.slice(k, k + n)
    k += n
    if (r.some((x) => x.trim())) rows.push(r.concat(Array(Math.max(0, n - r.length)).fill('')))
    if (k < rest.length && !rest[k].trim()) k++ // the "| |" between packed rows
  }
  // only worth rewriting when it really was several rows on one line
  if (!rows.length) return null
  return [row(header), row(header.map(() => '---')), ...rows.map(row)]
}

export function repairTables(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) {
      out.push(line)
      continue
    }
    const packed = unpackLine(line)
    if (packed && packed.length > 2) {
      out.push(...packed)
      continue
    }
    // header followed by a separator row with the wrong number of cells
    const next = lines[i + 1]
    if (/^\s*\|.*\|\s*$/.test(line) && next !== undefined && /^\s*\|?\s*:?-{2,}/.test(next) && cells(next).every((c) => SEP_CELL.test(c) || !c.trim())) {
      const n = cells(line).length
      const sep = cells(next).filter((c) => c.trim())
      if (sep.length !== n) {
        out.push(line, row(Array.from({ length: n }, (_, j) => sep[j]?.trim() || '---')))
        i++
        continue
      }
    }
    out.push(line)
  }
  return out.join('\n')
}
