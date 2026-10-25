import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { TreeNode } from '@shared/types'
import { atomicWrite } from '../util'

export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'release', '.next', '__pycache__', '.venv', 'venv', '.cache', 'coverage', 'target'])
const MAX_READ_BYTES = 2 * 1024 * 1024

export class PathBoundaryError extends Error {
  constructor(p: string) {
    super(`Path is outside the approved project folder: ${p}`)
    this.name = 'PathBoundaryError'
  }
}

/**
 * Resolve a user/model supplied path against a project root and refuse anything that escapes it
 * (../ traversal, absolute paths elsewhere, other drives, UNC paths). Symlinks are resolved too.
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const rootAbs = path.resolve(root)
  const target = path.resolve(rootAbs, rel || '.')
  const check = (p: string): void => {
    const r = path.relative(rootAbs, p)
    if (r === '') return
    if (r.startsWith('..') || path.isAbsolute(r)) throw new PathBoundaryError(rel)
  }
  check(target)
  // Resolve symlinks of the deepest existing ancestor so a link cannot point outside.
  let probe = target
  while (true) {
    try {
      const real = await fs.realpath(probe)
      const realRoot = await fs.realpath(rootAbs)
      const r = path.relative(realRoot, real)
      if (r.startsWith('..') || path.isAbsolute(r)) throw new PathBoundaryError(rel)
      break
    } catch (e) {
      if (e instanceof PathBoundaryError) throw e
      const parent = path.dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }
  return target
}

export function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}

export async function listTree(root: string, rel = '', depth = 1): Promise<TreeNode[]> {
  const abs = await resolveInside(root, rel)
  const entries = await fs.readdir(abs, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const e of entries) {
    if (e.isDirectory() && IGNORED_DIRS.has(e.name)) continue
    const p = toRel(root, path.join(abs, e.name))
    const node: TreeNode = { name: e.name, path: p, dir: e.isDirectory() }
    if (node.dir && depth > 1) node.children = await listTree(root, p, depth - 1)
    nodes.push(node)
  }
  nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  return nodes
}

export async function readText(root: string, rel: string): Promise<string> {
  const abs = await resolveInside(root, rel)
  const st = await fs.stat(abs)
  if (st.isDirectory()) throw new Error(`${rel} is a directory`)
  if (st.size > MAX_READ_BYTES) throw new Error(`${rel} is too large to open (${Math.round(st.size / 1024)} KB)`)
  const buf = await fs.readFile(abs)
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${rel} looks like a binary file`)
  return buf.toString('utf8')
}

export async function readTextOrNull(root: string, rel: string): Promise<string | null> {
  try {
    return await readText(root, rel)
  } catch (e) {
    if (e instanceof PathBoundaryError) throw e
    return null
  }
}

export async function writeText(root: string, rel: string, content: string): Promise<void> {
  const abs = await resolveInside(root, rel)
  await atomicWrite(abs, content)
}

export async function createEntry(root: string, rel: string, dir: boolean): Promise<void> {
  const abs = await resolveInside(root, rel)
  if (dir) await fs.mkdir(abs, { recursive: true })
  else {
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, '', { flag: 'wx' })
  }
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

/** Plain-text / regex search across the project, skipping ignored and binary/large files. */
export async function searchText(root: string, query: string, opts: { regex?: boolean; glob?: string; max?: number } = {}): Promise<SearchHit[]> {
  const max = opts.max ?? 80
  const re = opts.regex ? new RegExp(query, 'i') : null
  const q = query.toLowerCase()
  const ext = opts.glob?.startsWith('*.') ? opts.glob.slice(1).toLowerCase() : null
  const hits: SearchHit[] = []
  const walk = async (dir: string): Promise<void> => {
    if (hits.length >= max) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (hits.length >= max) return
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name) && e.name !== '.dahl') await walk(abs)
        continue
      }
      if (ext && !e.name.toLowerCase().endsWith(ext)) continue
      let st
      try {
        st = await fs.stat(abs)
      } catch {
        continue
      }
      if (st.size > 1024 * 1024) continue
      const buf = await fs.readFile(abs)
      if (buf.subarray(0, 4000).includes(0)) continue
      const lines = buf.toString('utf8').split(/\r?\n/)
      for (let i = 0; i < lines.length && hits.length < max; i++) {
        const l = lines[i]
        if (re ? re.test(l) : l.toLowerCase().includes(q)) hits.push({ path: toRel(root, abs), line: i + 1, text: l.trim().slice(0, 240) })
      }
    }
  }
  await walk(path.resolve(root))
  return hits
}

/** Compact project outline for the agent's context (bounded size). */
export async function projectOutline(root: string, maxEntries = 120): Promise<string> {
  const lines: string[] = []
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 2 || lines.length >= maxEntries) return
    let nodes: TreeNode[]
    try {
      nodes = await listTree(root, rel, 1)
    } catch {
      return
    }
    for (const n of nodes) {
      if (lines.length >= maxEntries) return
      if (n.name === '.dahl') continue
      lines.push(`${'  '.repeat(depth)}${n.name}${n.dir ? '/' : ''}`)
      if (n.dir) await walk(n.path, depth + 1)
    }
  }
  await walk('', 0)
  return lines.join('\n')
}
