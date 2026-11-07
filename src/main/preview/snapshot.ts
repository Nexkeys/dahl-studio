// Page snapshot for the agent: Chrome's accessibility tree (CDP Accessibility.getFullAXTree) as a short outline with
// element refs, in the style of Playwright MCP. Pure, so it is tested with synthetic trees.

export interface AXValue {
  type?: string
  value?: unknown
}
export interface AXNode {
  nodeId: string
  ignored?: boolean
  role?: AXValue
  name?: AXValue
  value?: AXValue
  properties?: { name: string; value: AXValue }[]
  parentId?: string
  childIds?: string[]
  backendDOMNodeId?: number
}

/**
 * Element refs ("e1", "e2"...) for DOM nodes (backend node ids). A node keeps its ref for as long as the document
 * lives, so refs from an earlier snapshot still work; reset() on navigation, when every backend id becomes invalid.
 */
export class RefTable {
  private toRef = new Map<number, string>()
  private toNode = new Map<string, number>()
  private next = 1
  ref(backendId: number): string {
    let r = this.toRef.get(backendId)
    if (!r) {
      r = `e${this.next++}`
      this.toRef.set(backendId, r)
      this.toNode.set(r, backendId)
    }
    return r
  }
  node(ref: string): number | undefined {
    return this.toNode.get(String(ref).trim().replace(/^\[?ref=/, '').replace(/\]$/, ''))
  }
  reset(): void {
    this.toRef.clear()
    this.toNode.clear()
    this.next = 1
  }
  get size(): number {
    return this.toNode.size
  }
}

// never printed, and their children are not walked (text runs, bullets)
const SKIP = new Set(['InlineTextBox', 'LineBreak', 'ListMarker'])
// layout or inline-formatting wrappers: not printed, their children take their place
const WRAPPER = new Set(['generic', 'none', 'presentation', 'GenericContainer', 'Section', 'LayoutTable', 'LayoutTableRow', 'LayoutTableCell', 'strong', 'emphasis', 'mark', 'subscript', 'superscript', 'time', 'abbr', 'Abbr', 'deletion', 'insertion', 'Ruby', 'RubyAnnotation', 'IgnoredRole', 'Unknown'])
const VALUE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'TextField', 'ComboBoxMenuButton'])
const ROOTS = new Set(['RootWebArea', 'WebArea'])

type Item = { text: string } | { node: AXNode }

export interface SnapshotOptions {
  maxLines?: number
  maxChars?: number
  /** only the part of the page under this DOM node (backend id of a ref) */
  rootBackendId?: number
  /** children shown per element before "... N more" */
  maxChildren?: number
}

const clean = (v: unknown): string => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 3)}...` : s)

function attrs(n: AXNode, role: string): string {
  const out: string[] = []
  for (const p of n.properties ?? []) {
    const v = p.value?.value
    if (p.name === 'level' && role === 'heading') out.push(`[level=${v}]`)
    else if (p.name === 'checked' && v !== 'false' && v !== false) out.push(v === 'mixed' ? '[checked=mixed]' : '[checked]')
    else if (p.name === 'pressed' && v !== 'false' && v !== false) out.push(v === 'mixed' ? '[pressed=mixed]' : '[pressed]')
    else if (['disabled', 'selected', 'required', 'focused', 'readonly', 'modal'].includes(p.name) && (v === true || v === 'true')) out.push(`[${p.name}]`)
    else if (p.name === 'expanded') out.push(v === true || v === 'true' ? '[expanded]' : '[collapsed]')
    else if (p.name === 'invalid' && v && v !== 'false') out.push('[invalid]')
  }
  return out.length ? ` ${out.join(' ')}` : ''
}

/** The outline of the page, one element per line, with [ref=eN] on every element the agent can target. */
export function formatSnapshot(nodes: AXNode[], refs: RefTable, o: SnapshotOptions = {}): { text: string; lines: number; truncated: boolean } {
  const maxLines = o.maxLines ?? 400
  const maxChars = o.maxChars ?? 16000
  const maxChildren = o.maxChildren ?? 50
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const roleOf = (n: AXNode): string => String(n.role?.value ?? '')
  const out: string[] = []
  let chars = 0
  let hidden = 0
  // a ref is only handed out for a line that is really shown
  const push = (head: string, tail = '', backendId?: number): void => {
    if (out.length >= maxLines || chars + head.length + tail.length > maxChars) return void hidden++
    const line = `${head}${backendId !== undefined ? ` [ref=${refs.ref(backendId)}]` : ''}${tail}`
    out.push(line)
    chars += line.length + 1
  }

  // children of a node with wrappers flattened away and adjacent text runs merged
  const items = (n: AXNode): Item[] => {
    const raw: Item[] = []
    const walk = (id: string): void => {
      const c = byId.get(id)
      if (!c) return
      const role = roleOf(c)
      if (SKIP.has(role)) return
      if (role === 'StaticText') {
        const t = clean(c.name?.value)
        if (t) raw.push({ text: t })
      } else if (c.ignored || (WRAPPER.has(role) && !clean(c.name?.value))) for (const k of c.childIds ?? []) walk(k)
      else raw.push({ node: c })
    }
    for (const k of n.childIds ?? []) walk(k)
    const merged: Item[] = []
    for (const it of raw) {
      const last = merged[merged.length - 1]
      if ('text' in it && last && 'text' in last) last.text = `${last.text} ${it.text}`
      else merged.push('text' in it ? { text: it.text } : it)
    }
    return merged
  }

  const emit = (n: AXNode, depth: number): void => {
    const role = roleOf(n)
    const pad = '  '.repeat(depth)
    const name = clean(n.name?.value)
    const kids = items(n)
    const onlyText = kids.every((k) => 'text' in k)
    const text = onlyText ? clean(kids.map((k) => ('text' in k ? k.text : '')).join(' ')) : ''
    const head = `${pad}- ${role}${name ? ` ${JSON.stringify(clip(name, 120))}` : ''}${attrs(n, role)}`
    const url = role === 'link' ? clean(n.properties?.find((p) => p.name === 'url')?.value?.value) : ''
    const value = VALUE_ROLES.has(role) ? clean(n.value?.value) : ''
    const tail = (url ? ` -> ${clip(url, 100)}` : '') + (value ? `: ${clip(value, 200)}` : text && text !== name && !name.includes(text) ? `: ${clip(text, 300)}` : '')
    push(head, tail, n.backendDOMNodeId)
    if (onlyText) return
    emitItems(kids, depth + 1)
  }

  const emitItems = (kids: Item[], depth: number): void => {
    const pad = '  '.repeat(depth)
    kids.slice(0, maxChildren).forEach((k) => ('text' in k ? push(`${pad}- text: ${clip(k.text, 300)}`) : emit(k.node, depth)))
    if (kids.length > maxChildren) push(`${pad}- ... ${kids.length - maxChildren} more`)
  }

  let start: AXNode | undefined
  if (o.rootBackendId !== undefined) start = nodes.find((n) => n.backendDOMNodeId === o.rootBackendId)
  else start = nodes.find((n) => ROOTS.has(roleOf(n)) && !n.parentId) ?? nodes.find((n) => ROOTS.has(roleOf(n))) ?? nodes[0]
  if (!start) return { text: '(the page has no content yet)', lines: 0, truncated: false }
  const startRole = roleOf(start)
  if (ROOTS.has(startRole) || start.ignored || WRAPPER.has(startRole)) emitItems(items(start), 0)
  else emit(start, 0)
  if (hidden) out.push(`... ${hidden} more line(s) not shown. Call browser_snapshot with the ref of a section to read that part.`)
  return { text: out.join('\n') || '(no readable content)', lines: out.length, truncated: hidden > 0 }
}
