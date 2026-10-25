import path from 'node:path'
import { promises as fs } from 'node:fs'
import { atomicWrite } from './util'

/** Minimal interface of Electron's safeStorage so the vault can be unit-tested without Electron. */
export interface Encryptor {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

/**
 * Stores Dahl API keys encrypted with Electron safeStorage (Windows DPAPI, bound to the current
 * Windows user). Keys never leave the main process: the renderer only learns whether a slot is set.
 */
export class SecretVault {
  private dir: string
  private mem = new Map<string, string>()

  constructor(appDataDir: string, private enc: Encryptor) {
    this.dir = path.join(appDataDir, 'secrets')
  }

  private file(slot: string): string {
    return path.join(this.dir, `${slot.replace(/[^a-zA-Z0-9_.-]/g, '_')}.bin`)
  }

  async set(slot: string, key: string): Promise<void> {
    const trimmed = key.trim()
    if (!trimmed) return this.clear(slot)
    if (!this.enc.isEncryptionAvailable()) {
      throw new Error('Windows secure storage (DPAPI) is not available; refusing to store the key in plain text.')
    }
    const blob = this.enc.encryptString(trimmed)
    await atomicWrite(this.file(slot), blob.toString('base64'))
    this.mem.set(slot, trimmed)
  }

  async get(slot: string): Promise<string | null> {
    if (this.mem.has(slot)) return this.mem.get(slot)!
    try {
      const b64 = await fs.readFile(this.file(slot), 'utf8')
      const key = this.enc.decryptString(Buffer.from(b64, 'base64'))
      this.mem.set(slot, key)
      return key
    } catch {
      return null
    }
  }

  async has(slot: string): Promise<boolean> {
    return (await this.get(slot)) !== null
  }

  async clear(slot: string): Promise<void> {
    this.mem.delete(slot)
    await fs.rm(this.file(slot), { force: true })
  }

  /** All currently known secret values, used for redaction. */
  async allValues(): Promise<string[]> {
    const out: string[] = []
    const names = await fs.readdir(this.dir).catch(() => [] as string[])
    for (const s of [...new Set([...names.filter((n) => n.endsWith('.bin')).map((n) => n.slice(0, -4)), ...this.mem.keys()])]) {
      const v = await this.get(s)
      if (v) out.push(v)
    }
    return out
  }
}
