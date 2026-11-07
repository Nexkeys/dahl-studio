import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { OCR_HELPER_PS } from './helperScript'
import type { OcrWord } from './geometry'

/** Raw Windows OCR output: one array of words per line the engine found, boxes in the image's pixels. */
export interface RawOcr {
  lines: OcrWord[][]
  angle: number
}
export interface OcrInfo {
  maxDim: number
  lang: string
}

const START_TIMEOUT = 60_000
const REQUEST_TIMEOUT = 45_000
/** the helper uses about 60 MB; it exits after this long without work and starts again on the next request */
const IDLE_MS = 3 * 60_000

type Pending = { resolve: (r: RawOcr) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

/** One long-lived PowerShell process running Windows.Media.Ocr; requests are queued and answered in order. */
class WindowsOcrHelper {
  private proc: ChildProcess | null = null
  private ready: Promise<OcrInfo> | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private idle: NodeJS.Timeout | null = null

  info(): Promise<OcrInfo> {
    if (process.platform !== 'win32') return Promise.reject(new Error('Windows OCR is only available on Windows'))
    this.ready ??= this.start().catch((e) => {
      this.ready = null
      throw e
    })
    return this.ready
  }

  async recognize(imagePath: string): Promise<RawOcr> {
    await this.info()
    const id = this.nextId++
    return new Promise<RawOcr>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Windows OCR did not answer within 45 s'))
        this.kill() // a stuck engine is restarted on the next request
      }, REQUEST_TIMEOUT)
      this.pending.set(id, { resolve, reject, timer })
      this.touch()
      this.proc?.stdin?.write(JSON.stringify({ id, path: imagePath }) + '\n')
    })
  }

  kill(): void {
    const p = this.proc
    this.proc = null
    this.ready = null
    if (this.idle) clearTimeout(this.idle)
    for (const [, q] of this.pending) {
      clearTimeout(q.timer)
      q.reject(new Error('Windows OCR stopped'))
    }
    this.pending.clear()
    try {
      p?.stdin?.end()
      p?.kill()
    } catch {
      /* already gone */
    }
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => (this.pending.size ? this.touch() : this.kill()), IDLE_MS)
    this.idle.unref?.()
  }

  private async start(): Promise<OcrInfo> {
    const hash = createHash('sha1').update(OCR_HELPER_PS).digest('hex').slice(0, 10)
    const script = path.join(os.tmpdir(), `dahl-ocr-helper-${hash}.ps1`)
    // UTF-8 with BOM, so Windows PowerShell 5.1 reads the script as UTF-8
    await fs.writeFile(script, '﻿' + OCR_HELPER_PS, 'utf8')
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    proc.unref()
    let stderr = ''
    proc.stderr?.on('data', (d) => (stderr = (stderr + String(d)).slice(-2000)))
    const rl = readline.createInterface({ input: proc.stdout! })
    return new Promise<OcrInfo>((resolve, reject) => {
      let started = false
      const fail = (msg: string): void => {
        if (!started) reject(new Error(msg))
        if (this.proc === proc) this.kill()
      }
      const t = setTimeout(() => fail('Windows OCR did not start within 60 s'), START_TIMEOUT)
      proc.on('error', (e) => (clearTimeout(t), fail(`Windows OCR could not start: ${e.message}`)))
      proc.on('exit', (code) => (clearTimeout(t), fail(`Windows OCR stopped (exit ${code})${stderr ? `: ${stderr.split('\n').slice(0, 3).join(' ').trim()}` : ''}`)))
      rl.on('line', (line) => {
        let msg: any
        try {
          msg = JSON.parse(line.replace(/^﻿/, ''))
        } catch {
          return
        }
        if (!started) {
          clearTimeout(t)
          started = true
          if (!msg.ready) return reject(new Error(msg.error ?? 'Windows OCR is unavailable'))
          this.touch()
          return resolve({ maxDim: Number(msg.maxDim) || 4096, lang: String(msg.lang ?? '') })
        }
        const q = this.pending.get(Number(msg.id))
        if (!q) return
        this.pending.delete(Number(msg.id))
        clearTimeout(q.timer)
        if (msg.error) q.reject(new Error(msg.error))
        else q.resolve({ lines: msg.lines ?? [], angle: Number(msg.angle) || 0 })
      })
    })
  }
}

export const windowsOcrHelper = new WindowsOcrHelper()

/** Run Windows OCR on a PNG/JPEG/BMP file through the shared helper process. */
export function recognizeFile(imagePath: string): Promise<RawOcr> {
  return windowsOcrHelper.recognize(imagePath)
}
