import { groupLines } from '../ocr/geometry'
import { recognizeFile } from '../ocr/windowsOcr'

/**
 * Image reading moved to src/main/ocr (OCR pipeline, layout, breakdown) and src/main/vision (vision routing).
 * This keeps the old single-call API: Windows OCR on one file, lines with positions, no preprocessing.
 */
export interface OcrLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}

/** Run Windows OCR (the shared helper process) on an image file. Returns [] when there is no text. */
export async function windowsOcr(imagePath: string): Promise<OcrLine[]> {
  const r = await recognizeFile(imagePath)
  return groupLines(r.lines.flat()).map((l) => ({ text: l.text, x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h) }))
}
