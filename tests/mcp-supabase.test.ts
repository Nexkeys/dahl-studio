import { describe, it, expect } from 'vitest'
import { allowsWrites, effectiveArgs, isReadOnly, projectRef, setProjectRef, setReadOnly, validProjectRef } from '../src/shared/mcpArgs'
import { CATALOG, capabilityTestFor } from '../src/main/mcp/catalog'

const pinned = CATALOG.find((c) => c.id === 'supabase')!.install!.args!
// what an existing install (0.3.5 and earlier) saved
const legacy = ['-y', '@supabase/mcp-server-supabase@0.14.0', '--read-only']

describe('Supabase args: read-only toggle', () => {
  it('adds and removes --read-only without touching other args', () => {
    expect(isReadOnly(legacy)).toBe(true)
    const rw = setReadOnly(legacy, false)
    expect(rw).toEqual(['-y', '@supabase/mcp-server-supabase@0.14.0'])
    expect(isReadOnly(rw)).toBe(false)
    expect(setReadOnly(rw, true)).toEqual(legacy)
    expect(setReadOnly(['--read-only', 'x', '--read-only'], true)).toEqual(['x', '--read-only'])
  })
  it('only Supabase without --read-only counts as write access', () => {
    expect(allowsWrites('supabase', legacy)).toBe(false)
    expect(allowsWrites('supabase', setReadOnly(legacy, false))).toBe(true)
    expect(allowsWrites('filesystem', [])).toBe(false)
  })
})

describe('Supabase args: project ref', () => {
  it('sets, replaces and removes --project-ref', () => {
    const a = setProjectRef(legacy, 'abcdefghijklmnopqrst')
    expect(a).toEqual([...legacy, '--project-ref=abcdefghijklmnopqrst'])
    expect(projectRef(a)).toBe('abcdefghijklmnopqrst')
    const b = setProjectRef(a, 'zyxwvutsrqponmlkjihg')
    expect(b.filter((x) => x.startsWith('--project-ref'))).toEqual(['--project-ref=zyxwvutsrqponmlkjihg'])
    expect(setProjectRef(b, '')).toEqual(legacy)
    expect(setProjectRef(b, null)).toEqual(legacy)
  })
  it('understands and replaces the two-token form', () => {
    const a = ['-y', 'pkg', '--project-ref', 'abcdefghijklmnopqrst', '--read-only']
    expect(projectRef(a)).toBe('abcdefghijklmnopqrst')
    expect(setProjectRef(a, 'zyxwvutsrqponmlkjihg')).toEqual(['-y', 'pkg', '--read-only', '--project-ref=zyxwvutsrqponmlkjihg'])
    expect(projectRef(['--project-ref', '--read-only'])).toBeNull()
  })
  it('rejects refs that could inject shell syntax', () => {
    expect(validProjectRef('abcdefghijklmnopqrst')).toBe(true)
    for (const bad of ['abc def ghij', 'abcdef&calc', 'ABCDEFGH', 'abcdef"x', 'ab']) expect(() => setProjectRef(legacy, bad)).toThrow()
  })
})

describe('Supabase args: what really runs', () => {
  it('pinned catalogue args use the bin with explicit peers and are read-only by default', () => {
    expect(pinned).toContain('@supabase/mcp-server-supabase@0.14.0')
    expect(pinned).toContain('mcp-server-supabase')
    expect(isReadOnly(pinned)).toBe(true)
    expect(effectiveArgs('supabase', pinned, undefined)).toEqual(pinned)
  })
  it('an existing install keeps the pinned package but takes its read-only and project flags', () => {
    expect(effectiveArgs('supabase', pinned, legacy)).toEqual(pinned)
    const rw = effectiveArgs('supabase', pinned, setProjectRef(setReadOnly(legacy, false), 'abcdefghijklmnopqrst'))
    expect(rw).toEqual([...pinned.filter((a) => a !== '--read-only'), '--project-ref=abcdefghijklmnopqrst'])
    expect(rw.indexOf('mcp-server-supabase')).toBeLessThan(rw.indexOf('--project-ref=abcdefghijklmnopqrst'))
  })
  it('ignores untunable or unsafe saved args', () => {
    const saved = ['-y', 'evil-pkg@1.0.0', '--read-only', '--api-url=https://x', '--project-ref=abc&calc', '--project-ref', 'abcdefghij']
    expect(effectiveArgs('supabase', pinned, saved)).toEqual([...pinned.filter((a) => a !== '--read-only'), '--read-only', '--project-ref=abcdefghij'])
    expect(effectiveArgs('filesystem', ['${project}'], ['C:\\'])).toEqual(['${project}'])
  })
})

describe('Supabase capability test', () => {
  it('uses list_projects when listed, list_migrations when scoped to one project', () => {
    expect(capabilityTestFor('supabase', ['list_projects', 'list_migrations'])?.tool).toBe('list_projects')
    expect(capabilityTestFor('supabase', ['list_tables', 'list_migrations'])?.tool).toBe('list_migrations')
    expect(capabilityTestFor('supabase', [])?.tool).toBe('list_projects')
    expect(capabilityTestFor('filesystem', ['list_allowed_directories'])?.tool).toBe('list_allowed_directories')
    expect(capabilityTestFor('tooldash', ['x'])).toBeUndefined()
  })
})
