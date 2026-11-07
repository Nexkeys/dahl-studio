import type { ShellInfo } from '@shared/types'
import { childEnv } from '../terminal'

/**
 * PowerShell shell integration, one line and without double quotes so it survives the Windows command line
 * as a single -Command argument (no script file, so the execution policy does not apply; no -EncodedCommand,
 * which antivirus heuristics dislike). It wraps the user's own prompt (oh-my-posh and the like keep working) and
 * PSReadLine's ReadLine to print OSC 633 marks: A/B around the prompt, E (the command line, escaped) and C when a
 * command starts, D;<0|1> when it finished. The panel uses them for "running" state, Stop and "Run again".
 */
const PS_INTEGRATION = [
  '$Global:__dahlLastId = -1',
  '$Global:__dahlPrompt = $function:prompt',
  "function Global:__dahlEsc([string]$v) { [regex]::Replace($v, '[\\x00-\\x1f\\\\;]', { param($m) -join ([Text.Encoding]::UTF8.GetBytes($m.Value) | ForEach-Object { '\\x{0:x2}' -f $_ }) }) }",
  'function Global:prompt { $fc = [int]!$global:?; Set-StrictMode -Off; $h = Get-History -Count 1; $e = [char]27; $b = [char]7; $r = ' + "''" +
    "; if ($Global:__dahlLastId -ne -1) { if ($h.Id -eq $Global:__dahlLastId) { $r += $e + ']633;D' + $b } else { $r += $e + ']633;D;' + $fc + $b } }" +
    "; $r += $e + ']633;A' + $b + (& $Global:__dahlPrompt) + $e + ']633;B' + $b; $Global:__dahlLastId = $h.Id; $r }",
  "if (Get-Module PSReadLine) { $Global:__dahlReadLine = $function:PSConsoleHostReadLine; function Global:PSConsoleHostReadLine { $c = & $Global:__dahlReadLine; [Console]::Write([char]27 + ']633;E;' + (__dahlEsc $c) + [char]7 + [char]27 + ']633;C' + [char]7); $c } }"
].join('; ')

// cmd.exe has no hook for the command line, but its prompt can carry the prompt marks ($e is ESC)
const CMD_PROMPT = '$e]633;D$e\\$e]633;A$e\\$P$G$e]633;B$e\\'

// never handed to the user's shell: they would break Electron or Node tools started from it
const DROP_ENV = /^(FORCE_COLOR|NO_COLOR|ELECTRON_RUN_AS_NODE|ELECTRON_NO_ATTACH_CONSOLE|ELECTRON_ENABLE_LOGGING|GEMINI_API_KEY|GOOGLE_API_KEY|NVIDIA_API_KEY)$/i

/** Full environment (PowerShell fails with 8009001d without SystemRoot), minus AI keys, plus colour hints. */
export function ptyEnv(shell: ShellInfo, appVersion: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(childEnv())) if (v !== undefined && !DROP_ENV.test(k)) env[k] = v
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'DahlStudio'
  env.TERM_PROGRAM_VERSION = appVersion
  if (shell.id === 'gitbash') {
    env.TERM = 'xterm-256color'
    env.CHERE_INVOKING = '1' // a login shell otherwise starts in HOME, not the project
  }
  if (shell.id === 'cmd') env.PROMPT = CMD_PROMPT
  return env
}

export function shellArgs(shell: ShellInfo): string[] {
  if (shell.id === 'pwsh' || shell.id === 'powershell') return ['-NoLogo', '-NoExit', '-Command', PS_INTEGRATION]
  if (shell.id === 'gitbash') return ['--login', '-i']
  return []
}

/** For tests: the integration script must stay one line without double quotes. */
export const __psIntegration = PS_INTEGRATION
