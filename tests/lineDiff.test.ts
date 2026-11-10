import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { countLineChanges, totalChanges } from '@shared/lineDiff'
import { turnDiff } from '../src/main/agent/turnDiff'

describe('line counts for the changes pill', () => {
  it('counts added and removed lines like a diff', () => {
    expect(countLineChanges('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0 })
    expect(countLineChanges('a\nb\nc', 'a\nB\nc')).toEqual({ added: 1, removed: 1 })
    expect(countLineChanges('a\nc', 'a\nb\nc\nd')).toEqual({ added: 2, removed: 0 })
    expect(countLineChanges('', 'x\ny')).toEqual({ added: 2, removed: 0 })
    expect(countLineChanges('x\ny\nz', '')).toEqual({ added: 0, removed: 3 })
    expect(countLineChanges('a\r\nb\r\n', 'a\nb\n')).toEqual({ added: 0, removed: 0 })
  })

  it('handles large files without quadratic blow-up', () => {
    const before = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')
    const after = Array.from({ length: 5000 }, (_, i) => (i % 2 ? `line ${i}` : `changed ${i}`)).join('\n')
    const t = Date.now()
    expect(countLineChanges(before, after)).toEqual({ added: 2500, removed: 2500 })
    expect(Date.now() - t).toBeLessThan(5000)
  })

  it('sums files and says whether lines were counted', () => {
    expect(totalChanges([{ path: 'a', added: 3, removed: 1, created: false }, { path: 'b', added: 2, removed: 0, created: true }])).toEqual({ added: 5, removed: 1, counted: true })
    expect(totalChanges([{ path: 'a', added: 0, removed: 0, created: false, skipped: true }]).counted).toBe(false)
  })

  it("compares each file with the run's per-turn backup, without git", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dahl-turndiff-'))
    try {
      await mkdir(path.join(root, '.dahl', 'runs'), { recursive: true })
      await mkdir(path.join(root, 'src'))
      await writeFile(path.join(root, 'src', 'a.ts'), 'one\nTWO\nthree\nfour\n')
      await writeFile(path.join(root, 'src', 'new.ts'), 'x\ny\n')
      await writeFile(path.join(root, 'same.ts'), 'same\n')
      const run = { id: 'r1', backups: { 'src/a.ts': 'one\ntwo\nthree\n', 'src/new.ts': null, 'same.ts': 'same\n' } }
      await writeFile(path.join(root, '.dahl', 'runs', 'r1.json'), JSON.stringify(run))
      const files = await turnDiff(root, 'r1')
      expect(files).toEqual([
        { path: 'src/a.ts', added: 2, removed: 1, created: false },
        { path: 'src/new.ts', added: 2, removed: 0, created: true }
      ])
      expect(await turnDiff(root, '../../etc')).toEqual([])
      expect(await turnDiff(root, 'missing')).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
