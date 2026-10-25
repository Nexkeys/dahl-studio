import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Image breakdown for models that cannot see images (e.g. current Dahl models).
 * 1. Pixel analysis (size, palette, layout grid, likely regions) done in the renderer's canvas (Chromium decodes PNG/JPEG/WebP/GIF).
 * 2. Text recognition with the built-in Windows OCR engine (Windows.Media.Ocr) via PowerShell. No download, no account.
 * 3. Optionally a description from a vision-capable model the user has configured (done by the runner).
 */

export const PIXEL_ANALYSIS_JS = (dataUrl: string): string => `(async () => {
  const img = new Image(); img.src = ${JSON.stringify(dataUrl)}; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight; const s = Math.min(1, 320 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data; const buckets = new Map();
  const hex = (r,g,b) => '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
  for (let i = 0; i < d.length; i += 4) { if (d[i+3] < 128) continue; const k = (d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4); const b = buckets.get(k) || [0,0,0,0]; b[0]+=d[i]; b[1]+=d[i+1]; b[2]+=d[i+2]; b[3]++; buckets.set(k,b); }
  const total = [...buckets.values()].reduce((a,b)=>a+b[3],0) || 1;
  const palette = [...buckets.values()].sort((a,b)=>b[3]-a[3]).slice(0,10).map(b => ({ hex: hex(Math.round(b[0]/b[3]),Math.round(b[1]/b[3]),Math.round(b[2]/b[3])), pct: Math.round(b[3]*1000/total)/10 }));
  const G = 6, grid = [];
  for (let gy = 0; gy < G; gy++) { const row = []; for (let gx = 0; gx < G; gx++) {
    let r=0,g=0,bl=0,n=0,edges=0; const x0=Math.floor(gx*w/G), x1=Math.floor((gx+1)*w/G), y0=Math.floor(gy*h/G), y1=Math.floor((gy+1)*h/G);
    for (let yy=y0; yy<y1; yy++) for (let xx=x0; xx<x1; xx++) { const i=(yy*w+xx)*4; r+=d[i]; g+=d[i+1]; bl+=d[i+2]; n++;
      if (xx+1<x1) { const j=i+4; if (Math.abs(d[i]-d[j])+Math.abs(d[i+1]-d[j+1])+Math.abs(d[i+2]-d[j+2]) > 60) edges++; } }
    n = n || 1; row.push({ c: hex(Math.round(r/n),Math.round(g/n),Math.round(bl/n)), detail: Math.round(edges*100/n) }); } grid.push(row); }
  let lum = 0; for (let i = 0; i < d.length; i += 4) lum += 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; lum /= (d.length/4);
  return { width: W, height: H, aspect: (W/H).toFixed(2), meanLuminance: Math.round(lum), theme: lum > 140 ? 'light' : 'dark', palette, grid };
})()`

export interface OcrLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}

const OCR_PS = `
param([string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType=WindowsRuntime] | Out-Null
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'No OCR language pack available' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = foreach ($l in $result.Lines) { $ws = @($l.Words); $r = @($ws[0].BoundingRect)[0]; $e = @($ws[$ws.Count - 1].BoundingRect)[0]; [pscustomobject]@{ text = [string]$l.Text; x = [int][double]$r.X; y = [int][double]$r.Y; w = [int]([double]$e.X + [double]$e.Width - [double]$r.X); h = [int][double]$r.Height } }
ConvertTo-Json -InputObject @($lines) -Compress
`

/** Run Windows OCR on an image file. Returns [] when there is no text; throws when OCR is unavailable. */
export async function windowsOcr(imagePath: string): Promise<OcrLine[]> {
  if (process.platform !== 'win32') throw new Error('Windows OCR is only available on Windows')
  const script = path.join(os.tmpdir(), 'dahl-ocr.ps1')
  await fs.writeFile(script, OCR_PS, 'utf8')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', imagePath], { windowsHide: true, timeout: 45000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).split('\n').slice(0, 3).join(' ').trim()))
      try {
        const out = stdout.trim()
        resolve(out ? (JSON.parse(out) as OcrLine[]) : [])
      } catch {
        resolve([])
      }
    })
  })
}

export function formatBreakdown(name: string, px: any, ocr: OcrLine[] | string, vision?: string): string {
  const lines: string[] = [`Image breakdown: ${name}`]
  if (px) {
    lines.push(`Size: ${px.width}x${px.height} px (aspect ${px.aspect}), overall ${px.theme} (mean luminance ${px.meanLuminance}/255)`)
    lines.push(`Dominant colours: ${px.palette.map((p: any) => `${p.hex} ${p.pct}%`).join(', ')}`)
    lines.push('Layout grid (6x6, rows top to bottom; each cell = average colour / detail% where high detail suggests text or imagery):')
    for (const row of px.grid) lines.push('  ' + row.map((c: any) => `${c.c}/${c.detail}`).join('  '))
  }
  if (typeof ocr === 'string') lines.push(`Text recognition: unavailable (${ocr})`)
  else if (!ocr.length) lines.push('Text recognition (Windows OCR): no text found')
  else {
    lines.push(`Text recognition (Windows OCR), ${ocr.length} lines with positions (x,y in px):`)
    for (const l of ocr.slice(0, 150)) lines.push(`  [${l.x},${l.y} ${l.w}x${l.h}] ${l.text}`)
  }
  if (vision) lines.push('', 'Description from a vision-capable model:', vision)
  return lines.join('\n')
}
