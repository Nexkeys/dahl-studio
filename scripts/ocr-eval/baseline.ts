import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The OCR as it was before 0.4.0 (src/main/tools/image.ts windowsOcr at 933f2bc), kept only to measure the
 * improvement: one new PowerShell process per image, the original image as is, Windows OCR's own lines.
 */
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

export async function baselineOcr(imagePath: string): Promise<{ text: string; x: number; y: number; w: number; h: number }[]> {
  const script = path.join(os.tmpdir(), 'dahl-ocr-baseline.ps1')
  await fs.writeFile(script, OCR_PS, 'utf8')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', imagePath], { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).split('\n').slice(0, 3).join(' ').trim()))
      try {
        const out = stdout.trim()
        resolve(out ? JSON.parse(out) : [])
      } catch {
        resolve([])
      }
    })
  })
}
