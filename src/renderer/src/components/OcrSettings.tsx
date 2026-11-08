import { useEffect, useState } from 'react'
import type { OcrEngineStatus } from '@shared/types'
import { api, updateSettings, useStore } from '../store'

/** Settings > Behaviour: the optional accurate OCR engine (PaddleOCR PP-OCRv5), with its real availability. */
export function OcrSettings() {
  const on = useStore((s) => !!s.settings?.accurateOcr)
  const [status, setStatus] = useState<OcrEngineStatus | null>(null)
  useEffect(() => {
    void api.invoke<OcrEngineStatus>('ocr:status').then(setStatus).catch(() => setStatus(null))
  }, [on])
  const mb = status?.downloadMb ?? 13
  return (
    <label className="check">
      <input type="checkbox" checked={on} onChange={(e) => void updateSettings({ accurateOcr: e.target.checked })} /> Accurate OCR (downloads about {mb} MB on first use): reads text in images and scanned PDFs with PaddleOCR PP-OCRv5 instead of Windows OCR
      {status && <span className="muted small"> {status.message}</span>}
    </label>
  )
}
