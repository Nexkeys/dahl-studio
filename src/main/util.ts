import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Write a file atomically: write temp file, then rename over target. Survives interrupted writes. */
export async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  await fs.writeFile(tmp, data, 'utf8')
  await fs.rename(tmp, file)
}

/** Read JSON; returns fallback when missing. Corrupted files are moved aside (.corrupt) instead of crashing. */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    await fs.rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {})
    return fallback
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await atomicWrite(file, JSON.stringify(value, null, 2))
}

export async function appendJsonl(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(value) + '\n', 'utf8')
}

const SECRET_PATTERNS: RegExp[] = [
  /dahl_[A-Za-z0-9_\-]{6,}/g,
  /Bearer\s+[A-Za-z0-9._\-]{8,}/gi,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /sk-[A-Za-z0-9_\-]{16,}/g
]

/** Remove anything that looks like a credential before it reaches logs, UI errors or model context. */
export function redact(text: string, extra: string[] = []): string {
  let out = text
  for (const s of extra) if (s && s.length >= 6) out = out.split(s).join('[REDACTED]')
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]')
  return out
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) total += await dirSize(p)
    else {
      try {
        total += (await fs.stat(p)).size
      } catch {
        /* ignore */
      }
    }
  }
  return total
}
