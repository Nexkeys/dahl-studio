/**
 * User-tunable flags of catalogue MCP servers (pure: shared by the main process, the renderer and tests).
 * Catalogue servers always run their pinned catalogue arguments; only the flags listed in TUNABLE are taken from the
 * saved args (edited through `mcp:update` patch.args), so a saved copy can never change the package or version.
 * Values are restricted to a safe character set because npx is started through the Windows shell.
 */

export const READ_ONLY = '--read-only'
export const PROJECT_REF = '--project-ref'

/** catalogue id -> flags (bare "--flag" or "--flag=value") the user may switch on or off */
export const TUNABLE: Record<string, string[]> = { supabase: [READ_ONLY, PROJECT_REF] }

const SAFE_FLAG = /^--[a-z][a-z-]*(=[A-Za-z0-9_.,-]+)?$/

const flagName = (a: string): string => a.split('=')[0]

/** true when `ref` looks like a Supabase project ref (lowercase letters and digits; real refs are 20 letters) */
export function validProjectRef(ref: string): boolean {
  return /^[a-z0-9]{6,40}$/.test(ref)
}

export function isReadOnly(args: string[] | undefined): boolean {
  return (args ?? []).includes(READ_ONLY)
}

/** Adds or removes --read-only (all copies), keeping every other argument in order. */
export function setReadOnly(args: string[], on: boolean): string[] {
  const out = args.filter((a) => a !== READ_ONLY)
  return on ? [...out, READ_ONLY] : out
}

/** The --project-ref value ("--project-ref=x" or "--project-ref x"), or null. */
export function projectRef(args: string[] | undefined): string | null {
  const a = args ?? []
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(`${PROJECT_REF}=`)) return a[i].slice(PROJECT_REF.length + 1) || null
    if (a[i] === PROJECT_REF && a[i + 1] && !a[i + 1].startsWith('--')) return a[i + 1]
  }
  return null
}

/** Sets, replaces (empty: removes) --project-ref. Throws on a ref that is not letters and digits. */
export function setProjectRef(args: string[], ref: string | null): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(`${PROJECT_REF}=`)) continue
    if (args[i] === PROJECT_REF) {
      if (args[i + 1] && !args[i + 1].startsWith('--')) i++
      continue
    }
    out.push(args[i])
  }
  const r = (ref ?? '').trim()
  if (!r) return out
  if (!validProjectRef(r)) throw new Error('A project ref is only lowercase letters and digits (Project Settings > General > Project ID).')
  return [...out, `${PROJECT_REF}=${r}`]
}

/**
 * Arguments a catalogue server really runs with: the pinned catalogue args without their tunable flags, plus the
 * tunable flags found in the saved args (normalised to "--flag=value"; unsafe values are dropped).
 * Without saved args the pinned args are used as they are.
 */
export function effectiveArgs(catalogId: string | undefined, pinned: string[], saved: string[] | undefined): string[] {
  const tun = TUNABLE[catalogId ?? '']
  if (!tun || !saved) return pinned
  const keep = (a: string): boolean => tun.includes(flagName(a))
  const base = pinned.filter((a) => !keep(a))
  const extra: string[] = []
  for (let i = 0; i < saved.length; i++) {
    let a = saved[i]
    if (!keep(a)) continue
    // "--project-ref abc" form: fold the value in
    if (!a.includes('=') && a !== READ_ONLY && saved[i + 1] && !saved[i + 1].startsWith('--')) a = `${a}=${saved[++i]}`
    if (SAFE_FLAG.test(a) && !extra.some((x) => flagName(x) === flagName(a))) extra.push(a)
  }
  return [...base, ...extra]
}

/** true when a catalogue server is configured to make changes (Supabase without --read-only). */
export function allowsWrites(catalogId: string | undefined, args: string[] | undefined): boolean {
  return catalogId === 'supabase' && !isReadOnly(args)
}
