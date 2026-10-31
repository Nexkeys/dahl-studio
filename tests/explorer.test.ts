import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEntry, PathBoundaryError } from '../src/main/fs/workspace'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-explorer-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const isDir = (rel: string) => fs.stat(path.join(dir, rel)).then((s) => s.isDirectory())

describe('createEntry', () => {
  it('creates a folder', async () => {
    await createEntry(dir, 'assets', true)
    expect(await isDir('assets')).toBe(true)
  })

  it('creates nested folders and files, including inside existing folders', async () => {
    await createEntry(dir, 'src/components/new', true)
    expect(await isDir('src/components/new')).toBe(true)
    await createEntry(dir, 'src/components/other', true)
    expect(await isDir('src/components/other')).toBe(true)
    await createEntry(dir, 'src\\lib\\util.ts', false)
    expect(await fs.readFile(path.join(dir, 'src/lib/util.ts'), 'utf8')).toBe('')
  })

  it('refuses a folder or file that already exists', async () => {
    await createEntry(dir, 'assets', true)
    await expect(createEntry(dir, 'assets', true)).rejects.toThrow(/already exists/)
    await expect(createEntry(dir, 'assets/', true)).rejects.toThrow(/already exists/)
    await createEntry(dir, 'a.txt', false)
    await expect(createEntry(dir, 'a.txt', false)).rejects.toThrow(/already exists/)
    await expect(createEntry(dir, 'a.txt', true)).rejects.toThrow(/already exists/)
  })

  it('rejects path traversal, empty names and invalid characters', async () => {
    await expect(createEntry(dir, '../escape', true)).rejects.toBeInstanceOf(PathBoundaryError)
    await expect(createEntry(dir, 'src/../../escape.txt', false)).rejects.toBeInstanceOf(PathBoundaryError)
    await expect(fs.stat(path.join(dir, '..', 'escape'))).rejects.toThrow()
    await expect(createEntry(dir, '', true)).rejects.toThrow(/required/)
    await expect(createEntry(dir, '  ', true)).rejects.toThrow(/required/)
    await expect(createEntry(dir, 'bad?name', true)).rejects.toThrow(/Invalid characters/)
    await expect(createEntry(dir, 'a:b.txt', false)).rejects.toThrow(/Invalid characters/)
  })
})
