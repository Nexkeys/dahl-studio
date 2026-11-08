import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { OcrEngineFns } from './pipeline'

/**
 * Optional accurate OCR: PaddleOCR PP-OCRv5 (mobile text detection + Latin-script recognition) as ONNX models,
 * downloaded on first use into <app data>/ocr-models, pinned to exact Hugging Face revisions and checked by SHA-256.
 * Running them needs an ONNX runtime (onnxruntime-node or onnxruntime-web), which this build does not include: until
 * one is added, the engine reports itself unavailable and Windows OCR is used. Nothing is faked.
 */

export interface ModelFile {
  name: string
  url: string
  sha256: string
  size: number
}

// Verified 2026-11-08 with HEAD requests (302/307 to the CDN, then 200 with these content lengths); the ONNX hashes
// are the Hugging Face LFS SHA-256 ids, the .yml hashes were computed from downloaded copies.
const HF = 'https://huggingface.co/PaddlePaddle'
const DET = `${HF}/PP-OCRv5_mobile_det_onnx/resolve/e6f4fa85f00e168c862bc462aebca69eef9b3d3d`
const REC = `${HF}/latin_PP-OCRv5_mobile_rec_onnx/resolve/89d3a50e2c27e2e7cceeab0e944c25c807d5db4f`
export const PADDLE_FILES: ModelFile[] = [
  { name: 'det.onnx', url: `${DET}/inference.onnx`, sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d', size: 4_826_518 },
  { name: 'det.yml', url: `${DET}/inference.yml`, sha256: '98069072e1b6b37d727fd9d9f11725faa46d6ea0de012f2ed26caea011c37699', size: 903 },
  { name: 'rec.onnx', url: `${REC}/inference.onnx`, sha256: '7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498', size: 8_042_023 },
  { name: 'rec.yml', url: `${REC}/inference.yml`, sha256: '0bbe984570f597af3638e50bdf2e8276f3ab26a61966096538b3b0d1849f5c84', size: 6_817 }
]
/** shown on the Settings toggle */
export const ACCURATE_DOWNLOAD_MB = Math.round(PADDLE_FILES.reduce((a, f) => a + f.size, 0) / 1_000_000)
const RUNTIMES = ['onnxruntime-node', 'onnxruntime-web']

export const modelDir = (appDir: string): string => path.join(appDir, 'ocr-models', 'pp-ocrv5-latin')

async function sha256File(file: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

/** Files already present with the right size and hash. */
export async function verifiedFiles(dir: string, files = PADDLE_FILES): Promise<string[]> {
  const ok: string[] = []
  for (const f of files) {
    const p = path.join(dir, f.name)
    const st = await fs.stat(p).catch(() => null)
    if (st?.size === f.size && (await sha256File(p)) === f.sha256) ok.push(f.name)
  }
  return ok
}

/**
 * Download every missing file (to a .part file, renamed only after its size and SHA-256 match). A file that does
 * not match is deleted and reported; nothing unverified is ever kept.
 */
export async function ensureModels(dir: string, o: { fetchFn?: typeof fetch; signal?: AbortSignal; onProgress?(done: number, total: number): void; files?: ModelFile[] } = {}): Promise<{ downloaded: string[]; bytes: number }> {
  const files = o.files ?? PADDLE_FILES
  const doFetch = o.fetchFn ?? fetch
  await fs.mkdir(dir, { recursive: true })
  const have = new Set(await verifiedFiles(dir, files))
  const total = files.reduce((a, f) => a + f.size, 0)
  let done = files.filter((f) => have.has(f.name)).reduce((a, f) => a + f.size, 0)
  const downloaded: string[] = []
  for (const f of files) {
    if (have.has(f.name)) continue
    const res = await doFetch(f.url, { signal: o.signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`Download failed for ${f.name}: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const hash = createHash('sha256').update(buf).digest('hex')
    if (buf.length !== f.size || hash !== f.sha256) throw new Error(`${f.name} did not match its pinned checksum (got ${buf.length} bytes, sha256 ${hash.slice(0, 12)}...); it was not saved.`)
    const part = path.join(dir, `${f.name}.part`)
    await fs.writeFile(part, buf)
    await fs.rename(part, path.join(dir, f.name))
    downloaded.push(f.name)
    done += f.size
    o.onProgress?.(done, total)
  }
  return { downloaded, bytes: done }
}

/** Which ONNX runtime package can be loaded, if any. */
export function onnxRuntime(): string | null {
  const req = createRequire(typeof __filename === 'string' ? __filename : path.join(process.cwd(), 'index.js'))
  for (const r of RUNTIMES) {
    try {
      req.resolve(r)
      return r
    } catch {
      /* not installed */
    }
  }
  return null
}

export interface AccurateStatus {
  /** the ONNX runtime package found, or null */
  runtime: string | null
  modelsReady: boolean
  downloadMb: number
  /** one sentence for Settings */
  message: string
}

export async function accurateStatus(appDir: string): Promise<AccurateStatus> {
  const runtime = onnxRuntime()
  const modelsReady = (await verifiedFiles(modelDir(appDir))).length === PADDLE_FILES.length
  const message = !runtime
    ? `Not available in this build: running the PP-OCRv5 models needs the onnxruntime-node (or onnxruntime-web) package, which is not installed. Windows OCR is used meanwhile.`
    : modelsReady
      ? 'Models downloaded and verified.'
      : `The models (about ${ACCURATE_DOWNLOAD_MB} MB) download on first use.`
  return { runtime, modelsReady, downloadMb: ACCURATE_DOWNLOAD_MB, message }
}

/**
 * The engine to use when the user turned Accurate OCR on. Returns no engine (with the reason as a note for the
 * breakdown) while the ONNX runtime is missing, so models are not downloaded for nothing.
 */
export async function accurateEngine(appDir: string): Promise<{ engine?: { fns: OcrEngineFns; name: string; id: string }; note?: string }> {
  const runtime = onnxRuntime()
  if (!runtime) return { note: 'Note: Accurate OCR is on, but its ONNX runtime (onnxruntime-node) is not part of this build, so Windows OCR was used.' }
  await ensureModels(modelDir(appDir))
  // A runtime is present but no PP-OCRv5 inference is implemented on top of it yet (detection post-processing and
  // CTC decoding): say so rather than pretend.
  return { note: `Note: Accurate OCR models are downloaded, but the ${runtime} inference step is not implemented in this build, so Windows OCR was used.` }
}
