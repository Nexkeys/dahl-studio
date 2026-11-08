// Finds and reads the instruction files other coding tools use: CLAUDE.md (with @path imports), AGENTS.md,
// .cursor/rules/*.mdc, the legacy .cursorrules and .github/copilot-instructions.md. Every path stays inside the project.
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { InstructionFileInfo } from '@shared/types'
import { IGNORED_DIRS, resolveInside } from '../fs/workspace'
import { parseFrontmatter } from '../skills/frontmatter'
import { matchGlob, splitGlobs } from './glob'

export interface Source {
  path: string
  kind: InstructionFileInfo['kind']
  reason: string
  content: string
  /** description-only rule: only its description goes into the prompt */
  listed?: boolean
}

const MAX_FILE_BYTES = 256 * 1024
/** CLAUDE.md imports: at most this many hops from the file that started the chain */
export const MAX_IMPORT_DEPTH = 4
const cache = new Map<string, { mtimeMs: number; size: number; text: string }>()

const posix = (p: string): string => p.replace(/\\/g, '/')

/** Read a project-relative file, or null when it is missing, a folder, too large, binary or outside the project. */
export async function readProjectFile(root: string, rel: string): Promise<string | null> {
  try {
    const abs = await resolveInside(root, rel)
    const st = await fs.stat(abs)
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null
    const hit = cache.get(abs)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.text
    const buf = await fs.readFile(abs)
    if (buf.subarray(0, 4000).includes(0)) return null
    const text = buf.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    cache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, text })
    return text
  } catch {
    return null
  }
}

/** @path references outside code blocks and inline code. Only path-like tokens count (a slash or a file extension). */
export function findImports(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const out: string[] = []
  const re = /(?:^|\s)@((?:~|\.{1,2})?\/?[\w.-]+(?:\/[\w.@-]+)*)/g
  for (let m = re.exec(prose); m; m = re.exec(prose)) {
    const p = m[1].replace(/[.,;:!?)]+$/, '')
    if (p.includes('/') || /\.[a-z0-9]{1,6}$/i.test(p)) out.push(p)
  }
  return [...new Set(out)]
}

/**
 * A CLAUDE.md and everything it imports, depth first, each file once. Imports resolve relative to the importing
 * file; home-folder (~) imports and paths outside the project are skipped.
 */
export async function claudeWithImports(root: string, rel: string, reason: string, seen: Set<string>): Promise<Source[]> {
  const out: Source[] = []
  const visit = async (file: string, why: string, kind: Source['kind'], depth: number): Promise<void> => {
    const key = file.toLowerCase()
    if (seen.has(key)) return
    const text = await readProjectFile(root, file)
    if (text === null) return
    seen.add(key)
    out.push({ path: file, kind, reason: why, content: text })
    if (depth >= MAX_IMPORT_DEPTH) return
    for (const imp of findImports(text)) {
      if (imp.startsWith('~')) continue
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), imp.replace(/^\//, '')))
      if (target.startsWith('..')) continue
      await visit(target, `imported by ${file}`, 'import', depth + 1)
    }
  }
  await visit(rel, reason, 'claude', 0)
  return out
}

/** Folders from the root (".") down to each working path's folder, shallow first. */
export function foldersOf(working: string[]): string[] {
  const set = new Set<string>()
  for (const w of working) {
    const parts = posix(w).replace(/^\.\//, '').split('/').filter(Boolean)
    // instruction files shipped inside dependencies or build output are not the project's
    if (parts.some((p) => p === '..' || IGNORED_DIRS.has(p))) continue
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'))
  }
  return [...set].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
}

async function listMdc(root: string, dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 3 || out.length > 100) return
    const abs = await resolveInside(root, rel).catch(() => null)
    if (!abs) return
    for (const e of await fs.readdir(abs, { withFileTypes: true }).catch(() => [])) {
      const child = `${rel}/${e.name}`
      if (e.isDirectory()) await walk(child, depth + 1)
      else if (e.name.toLowerCase().endsWith('.mdc')) out.push(child)
    }
  }
  await walk(dir, 0)
  return out.sort()
}

/**
 * Cursor rules from .cursor/rules at the root and in the working folders. alwaysApply rules always load; glob rules
 * load when a working file matches; rules with only a description are listed for the model to read on request;
 * manual rules load only when the message mentions @rule-name.
 */
export async function cursorRules(root: string, folders: string[], working: string[], prompt: string): Promise<Source[]> {
  const out: Source[] = []
  for (const base of ['', ...folders]) {
    for (const file of await listMdc(root, base ? `${base}/.cursor/rules` : '.cursor/rules')) {
      const text = await readProjectFile(root, file)
      if (text === null) continue
      const fm = parseFrontmatter(text)
      const description = typeof fm.data.description === 'string' ? fm.data.description.trim() : ''
      const globs = splitGlobs(fm.data.globs)
      const name = path.posix.basename(file, '.mdc')
      const local = (w: string): string => (base && w.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? w.slice(base.length + 1) : w)
      const hit = globs.length ? working.find((w) => globs.some((g) => matchGlob(g, w) || (base && matchGlob(g, local(w))))) : undefined
      if (fm.data.alwaysApply === true) out.push({ path: file, kind: 'cursor-rule', reason: 'alwaysApply', content: fm.body })
      else if (hit) out.push({ path: file, kind: 'cursor-rule', reason: `globs ${globs.join(', ')} match ${hit}`, content: fm.body })
      else if (new RegExp(`(^|\\s)@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(prompt)) out.push({ path: file, kind: 'cursor-rule', reason: `mentioned as @${name}`, content: fm.body })
      else if (description) out.push({ path: file, kind: 'cursor-rule', reason: description, content: '', listed: true })
    }
  }
  return out
}
