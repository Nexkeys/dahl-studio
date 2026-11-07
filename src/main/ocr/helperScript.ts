/**
 * The long-lived Windows OCR helper (Windows.Media.Ocr through Windows PowerShell 5.1). It starts once, loads the
 * WinRT types and the OCR engine, prints one "ready" line with OcrEngine.MaxImageDimension, then answers one JSON
 * request per stdin line ({"id":1,"path":"C:\\x.png"}) with one JSON line of words and boxes. Starting PowerShell
 * per image cost 1 to 3 s each time; a request to the running helper takes about 50 to 300 ms.
 */
export const OCR_HELPER_PS = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation?1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType=WindowsRuntime] | Out-Null
function Esc([string]$s) { $s.Replace('\', '\\').Replace('"', '\"').Replace([string][char]13, ' ').Replace([string][char]10, ' ').Replace([string][char]9, ' ') }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { [Console]::Out.WriteLine('{"ready":false,"error":"No OCR language pack is installed for your Windows display language"}'); exit 1 }
$max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
[Console]::Out.WriteLine('{"ready":true,"maxDim":' + $max + ',"lang":"' + (Esc $engine.RecognizerLanguage.LanguageTag) + '"}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $id = 0
  try {
    $req = ConvertFrom-Json $line
    $id = [int]$req.id
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync([string]$req.path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{"id":' + $id + ',"lines":[')
    $li = 0
    foreach ($l in $result.Lines) {
      if ($li -gt 0) { [void]$sb.Append(',') }
      [void]$sb.Append('[')
      $wi = 0
      foreach ($w in $l.Words) {
        $r = $w.BoundingRect
        if ($wi -gt 0) { [void]$sb.Append(',') }
        [void]$sb.Append('{"t":"' + (Esc $w.Text) + '","x":' + [int][double]$r.X + ',"y":' + [int][double]$r.Y + ',"w":' + [int][double]$r.Width + ',"h":' + [int][double]$r.Height + '}')
        $wi++
      }
      [void]$sb.Append(']')
      $li++
    }
    $angle = if ($null -ne $result.TextAngle) { [double]$result.TextAngle } else { 0 }
    [void]$sb.Append('],"angle":' + $angle.ToString([System.Globalization.CultureInfo]::InvariantCulture) + '}')
    $stream.Dispose()
    [Console]::Out.WriteLine($sb.ToString())
  } catch {
    [Console]::Out.WriteLine('{"id":' + $id + ',"error":"' + (Esc $_.Exception.Message) + '"}')
  }
  [Console]::Out.Flush()
}
`
