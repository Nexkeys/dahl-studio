import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadInstructions, loadInstructionsCached, workingSet } from '../src/main/instructions'
import { findImports } from '../src/main/instructions/sources'
import { matchGlob, splitGlobs } from '../src/main/instructions/glob'
import type { ChatMessage } from '../src/shared/types'

let root: string
const write = async (rel: string, text: string) => {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true })
  await fs.writeFile(path.join(root, rel), text)
}
const paths = (r: { files: { path: string; listed?: boolean }[] }) => r.files.filter((f) => !f.listed).map((f) => f.path)

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-ins-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('globs', () => {
  it('matches Cursor style globs', () => {
    expect(matchGlob('*.tsx', 'src/ui/App.tsx')).toBe(true)
    expect(matchGlob('src/**/*.ts', 'src/a/b/c.ts')).toBe(true)
    expect(matchGlob('src/**/*.ts', 'src/c.ts')).toBe(true)
    expect(matchGlob('src/**/*.ts', 'lib/c.ts')).toBe(false)
    expect(matchGlob('src/*.ts', 'src/a/c.ts')).toBe(false)
    expect(matchGlob('**/*.{ts,tsx}', 'a/b.tsx')).toBe(true)
    expect(matchGlob('api/**', 'api/v1/users.py')).toBe(true)
    expect(splitGlobs('src/**/*.ts, *.{js,jsx}')).toEqual(['src/**/*.ts', '*.{js,jsx}'])
    expect(splitGlobs(['a', ' b '])).toEqual(['a', 'b'])
  })
})

describe('CLAUDE.md imports', () => {
  it('finds path-like @imports outside code, not mentions or emails', () => {
    const text = 'See @docs/style.md and @README.md. Ask @john or mail a@b.com.\n```\n@inside/code.md\n```\nAlso `@inline/code.md` and @~/.claude/me.md'
    expect(findImports(text)).toEqual(['docs/style.md', 'README.md', '~/.claude/me.md'])
  })

  it('follows imports up to 4 levels, relative to the importing file, once each, never outside the project', async () => {
    await write('CLAUDE.md', 'Root rules. See @docs/a.md and @../outside.md and @~/.claude/x.md')
    await write('docs/a.md', 'A imports @b.md')
    await write('docs/b.md', 'B imports @sub/c.md and back to @a.md')
    await write('docs/sub/c.md', 'C imports @d.md')
    await write('docs/sub/d.md', 'D imports @e.md')
    await write('docs/sub/e.md', 'E is five hops away')
    const r = await loadInstructions(root)
    expect(paths(r)).toEqual(['CLAUDE.md', 'docs/a.md', 'docs/b.md', 'docs/sub/c.md', 'docs/sub/d.md'])
    expect(r.files[1]).toMatchObject({ kind: 'import', reason: 'imported by CLAUDE.md' })
    expect(r.text).toContain('=== docs/sub/d.md (import, imported by docs/sub/c.md) ===')
    expect(r.text).not.toContain('E is five hops away')
  })
})

describe('instruction files', () => {
  it('returns nothing for a project without instruction files', async () => {
    expect(await loadInstructions(root)).toEqual({ text: '', files: [] })
  })

  it('AGENTS.md from the root down to the folder being worked on, root first and closest last', async () => {
    await write('AGENTS.md', 'root agents')
    await write('packages/api/AGENTS.md', 'api agents')
    await write('packages/web/AGENTS.md', 'web agents')
    await write('packages/AGENTS.md', 'packages agents')
    await write('node_modules/lib/AGENTS.md', 'dependency agents')
    const idle = await loadInstructions(root)
    expect(paths(idle)).toEqual(['AGENTS.md'])
    const r = await loadInstructions(root, { files: ['packages/api/src/users.ts', 'node_modules/lib/index.js'] })
    expect(paths(r)).toEqual(['AGENTS.md', 'packages/AGENTS.md', 'packages/api/AGENTS.md'])
    expect(r.text).toMatch(/closest to the file you are working on wins/)
    expect(r.text.indexOf('root agents')).toBeLessThan(r.text.indexOf('api agents'))
    expect(r.text).not.toContain('web agents')
    expect(r.text).not.toContain('dependency agents')
    expect(r.files.find((f) => f.path === 'packages/api/AGENTS.md')?.reason).toBe('applies to packages/api/')
  })

  it('nested CLAUDE.md loads only when working in its folder; a listed folder counts', async () => {
    await write('CLAUDE.md', 'root claude')
    await write('src/CLAUDE.md', 'src claude')
    expect(paths(await loadInstructions(root))).toEqual(['CLAUDE.md'])
    expect(paths(await loadInstructions(root, { files: [], dirs: ['src'] }))).toEqual(['CLAUDE.md', 'src/CLAUDE.md'])
  })

  it('Cursor rules: alwaysApply always, globs on matching files, description-only listed, manual on @mention', async () => {
    await write('.cursor/rules/style.mdc', '---\ndescription: Code style\nalwaysApply: true\n---\nUse tabs.')
    await write('.cursor/rules/react.mdc', '---\ndescription:\nglobs: src/**/*.tsx, *.jsx\nalwaysApply: false\n---\nUse function components.')
    await write('.cursor/rules/db/migrations.mdc', '---\ndescription: How to write database migrations\nglobs:\nalwaysApply: false\n---\nNever drop columns.')
    await write('.cursor/rules/manual.mdc', '---\nalwaysApply: false\n---\nManual rule body.')
    await write('.cursorrules', 'legacy rule')
    await write('.github/copilot-instructions.md', 'copilot rule')
    const none = await loadInstructions(root, { files: ['README.md'] })
    expect(paths(none)).toEqual(['.github/copilot-instructions.md', '.cursorrules', '.cursor/rules/style.mdc'])
    expect(none.files.find((f) => f.path === '.cursor/rules/db/migrations.mdc')).toMatchObject({ listed: true })
    expect(none.text).toContain('- .cursor/rules/db/migrations.mdc: How to write database migrations')
    expect(none.text).not.toContain('Never drop columns')
    expect(none.text).not.toContain('Use function components')
    const tsx = await loadInstructions(root, { files: ['src/ui/App.tsx'], prompt: 'fix it, see @manual' })
    expect(paths(tsx)).toEqual(expect.arrayContaining(['.cursor/rules/react.mdc', '.cursor/rules/manual.mdc']))
    expect(tsx.files.find((f) => f.path === '.cursor/rules/react.mdc')?.reason).toMatch(/match src\/ui\/App\.tsx/)
    expect(tsx.text).toContain('Use function components.')
    expect(tsx.text).not.toContain('alwaysApply: false')
  })

  it('caps each file and the total, and says what was shortened or left out', async () => {
    await write('CLAUDE.md', 'c'.repeat(20_000))
    await write('AGENTS.md', 'a'.repeat(20_000))
    await write('.cursorrules', 'r'.repeat(20_000))
    const r = await loadInstructions(root, { files: [] }, 10_000)
    expect(r.files.find((f) => f.path === 'CLAUDE.md')).toMatchObject({ truncated: true, chars: 20_000 })
    expect(r.text).toContain('[truncated: 12000 more characters; read the rest with read_file]')
    expect(r.files.find((f) => f.path === '.cursorrules')?.reason).toMatch(/not loaded, over the size limit/)
    expect(r.text.length).toBeLessThan(12_000)
  })

  it('the agent loop reuses a scan for the same working set and rescans when it changes', async () => {
    await write('AGENTS.md', 'root')
    await write('src/AGENTS.md', 'src')
    const a = loadInstructionsCached(root, { files: ['README.md'] })
    expect(loadInstructionsCached(root, { files: ['README.md'] })).toBe(a)
    expect(paths(await a)).toEqual(['AGENTS.md'])
    expect(paths(await loadInstructionsCached(root, { files: ['src/x.ts'] }))).toEqual(['AGENTS.md', 'src/AGENTS.md'])
  })

  it('workingSet collects tool paths, @mentions and attachments, newest last', () => {
    const tc = (name: string, args: unknown, id: string) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
    const messages: ChatMessage[] = [
      { role: 'user', content: 'look at @src/app.ts please' },
      { role: 'assistant', content: null, tool_calls: [tc('read_file', { path: 'lib/x.py' }, '1'), tc('list_dir', { path: 'docs/' }, '2'), tc('search', { query: 'q' }, '3'), tc('edit_file', { path: '../etc/passwd' }, '4')] }
    ]
    expect(workingSet(messages, ['attached.md'])).toEqual({ files: ['attached.md', 'src/app.ts', 'lib/x.py'], dirs: ['docs'] })
  })
})
