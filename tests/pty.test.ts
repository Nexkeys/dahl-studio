import { describe, expect, it } from 'vitest'
import { spawn as spawnChild } from 'node:child_process'
import { ACK_BATCH, AckBatcher, clampDims, FlowControl, HIGH_WATERMARK, isValidPtyId, LOW_WATERMARK, parseShellMark, unescapeMarkValue } from '../src/shared/pty'
import { detectShells, findOnPath, gitRootFromDir, pathDirs, windowsBuild } from '../src/main/pty/shells'
import { __psIntegration, ptyEnv, shellArgs } from '../src/main/pty/launch'
import type { ShellInfo } from '../src/shared/types'

describe('terminal flow control', () => {
  it('pauses above the high watermark and resumes below the low one, once each', () => {
    const f = new FlowControl()
    expect(f.sent(60_000)).toBe(false)
    expect(f.sent(HIGH_WATERMARK - 60_000)).toBe(false) // exactly at the mark: not above it
    expect(f.sent(1)).toBe(true)
    expect(f.sent(50_000)).toBe(false) // already paused
    expect(f.isPaused).toBe(true)
    expect(f.acked(100_000)).toBe(false) // backlog 50,001: still above LOW_WATERMARK
    expect(f.acked(50_001 - LOW_WATERMARK + 1)).toBe(true)
    expect(f.isPaused).toBe(false)
    expect(f.acked(5)).toBe(false)
  })

  it('never goes negative on stray or oversized ACKs', () => {
    const f = new FlowControl(10, 2)
    f.acked(500)
    f.acked(-20)
    expect(f.backlog).toBe(0)
    expect(f.sent(11)).toBe(true)
  })

  it('batches renderer ACKs, and a batch always fits under the low watermark', () => {
    const sent: number[] = []
    const a = new AckBatcher((n) => sent.push(n))
    for (let i = 0; i < 9; i++) a.drawn(1000)
    expect(sent).toEqual([5000])
    a.drawn(1000)
    expect(sent).toEqual([5000, 5000])
    expect(ACK_BATCH).toBeLessThan(LOW_WATERMARK)
  })

  it('a host and renderer pair never deadlocks: drawing everything always resumes the PTY', () => {
    const f = new FlowControl()
    let paused = false
    const a = new AckBatcher((n) => void (f.acked(n) && (paused = false)))
    let inFlight = 0
    for (let i = 0; i < 400; i++) {
      if (paused) {
        a.drawn(inFlight)
        inFlight = 0
        continue
      }
      inFlight += 4096
      if (f.sent(4096)) paused = true
    }
    a.drawn(inFlight)
    expect(f.backlog).toBeLessThan(ACK_BATCH)
    expect(f.isPaused).toBe(false)
  })
})

describe('shell integration marks (OSC 633)', () => {
  it('parses prompt, command line, executed and finished marks', () => {
    expect(parseShellMark('A')).toEqual({ kind: 'prompt-start' })
    expect(parseShellMark('B')).toEqual({ kind: 'prompt-end' })
    expect(parseShellMark('C')).toEqual({ kind: 'executed' })
    expect(parseShellMark('D;0')).toEqual({ kind: 'finished', code: 0 })
    expect(parseShellMark('D;1')).toEqual({ kind: 'finished', code: 1 })
    expect(parseShellMark('D')).toEqual({ kind: 'finished', code: null })
    expect(parseShellMark('E;npm run dev')).toEqual({ kind: 'command-line', command: 'npm run dev' })
    expect(parseShellMark('P;Cwd=C:\\x5c')).toBeNull()
  })

  it('unescapes what the PowerShell side escaped (backslash, semicolon, control and UTF-8 bytes)', () => {
    expect(unescapeMarkValue('cd C:\\x5cUsers\\x5cme\\x3b ls')).toBe('cd C:\\Users\\me; ls')
    expect(unescapeMarkValue('a\\x0ab')).toBe('a\nb')
    expect(unescapeMarkValue('echo \\xc3\\xa9t\\xc3\\xa9')).toBe('echo été')
    expect(parseShellMark('E;git commit -m \\x3bx')).toEqual({ kind: 'command-line', command: 'git commit -m ;x' })
  })

  it('validates ids and clamps sizes', () => {
    expect(isValidPtyId('tk2a9x-1_b')).toBe(true)
    expect(isValidPtyId('../x')).toBe(false)
    expect(isValidPtyId('')).toBe(false)
    expect(clampDims(0, 99999)).toEqual({ cols: 2, rows: 500 })
    expect(clampDims('x', undefined)).toEqual({ cols: 80, rows: 24 })
  })
})

describe('shell detection', () => {
  const env = {
    Path: 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd;C:\\Program Files\\nodejs\\;"C:\\Tools\\bin"',
    SystemRoot: 'C:\\Windows',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    ProgramFiles: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local'
  }
  const files = (...list: string[]) => (p: string) => list.some((f) => f.toLowerCase() === p.toLowerCase())

  it('finds PowerShell 7, Windows PowerShell, cmd and Git Bash (derived from git on PATH)', () => {
    const shells = detectShells(env, files(
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\system32\\cmd.exe',
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Windows\\system32\\bash.exe'
    ))
    expect(shells.map((s) => s.id)).toEqual(['pwsh', 'powershell', 'cmd', 'gitbash'])
    expect(shells[3].path).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
  })

  it('never offers WSL bash as Git Bash, and leaves out shells that are not installed', () => {
    const shells = detectShells({ ...env, Path: 'C:\\Windows\\system32' }, files('C:\\Windows\\system32\\bash.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'))
    expect(shells.map((s) => s.id)).toEqual(['powershell'])
  })

  it('prefers pwsh on PATH and reads env names case-insensitively', () => {
    const shells = detectShells({ PATH: 'D:\\pwsh', SYSTEMROOT: 'C:\\Windows' }, files('D:\\pwsh\\pwsh.exe', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'C:\\Windows\\System32\\cmd.exe'))
    expect(shells[0]).toEqual({ id: 'pwsh', name: 'PowerShell 7', path: 'D:\\pwsh\\pwsh.exe' })
    expect(shells.find((s) => s.id === 'cmd')?.path).toBe('C:\\Windows\\System32\\cmd.exe')
  })

  it('maps Git folders on PATH to the install root', () => {
    expect(gitRootFromDir('C:\\Program Files\\Git\\cmd')).toBe('C:\\Program Files\\Git')
    expect(gitRootFromDir('C:\\Program Files\\Git\\usr\\bin\\')).toBe('C:\\Program Files\\Git')
    expect(gitRootFromDir('D:\\Git\\mingw64\\bin')).toBe('D:\\Git')
    expect(gitRootFromDir('C:\\Program Files\\nodejs')).toBeNull()
    expect(pathDirs(env)).toContain('C:\\Tools\\bin')
    expect(findOnPath('node.exe', pathDirs(env), files('C:\\Program Files\\nodejs\\node.exe'))).toBe('C:\\Program Files\\nodejs\\node.exe')
  })

  it('reads the Windows build number from os.release()', () => {
    expect(windowsBuild('10.0.26100')).toBe(26100)
    expect(windowsBuild('6.1')).toBe(0)
  })
})

describe('shell launch', () => {
  const pwsh: ShellInfo = { id: 'powershell', name: 'Windows PowerShell', path: 'powershell.exe' }

  it('passes the integration as one command-line safe argument', () => {
    expect(__psIntegration).not.toMatch(/["\r\n]/)
    expect(__psIntegration.endsWith('\\')).toBe(false)
    expect(shellArgs(pwsh)).toEqual(['-NoLogo', '-NoExit', '-Command', __psIntegration])
    expect(shellArgs({ id: 'gitbash', name: 'Git Bash', path: 'bash.exe' })).toEqual(['--login', '-i'])
  })

  it('gives the shell a full environment without AI keys and with colour on', () => {
    const saved = { ...process.env }
    Object.assign(process.env, { OPENAI_API_KEY: 'sk-x', ANTHROPIC_API_KEY: 'a', DAHL_KEY: 'd', GEMINI_API_KEY: 'g', FORCE_COLOR: '0', ELECTRON_RUN_AS_NODE: '1' })
    try {
      const env = ptyEnv(pwsh, '0.4.0')
      for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DAHL_KEY', 'GEMINI_API_KEY', 'FORCE_COLOR', 'ELECTRON_RUN_AS_NODE']) expect(env[k]).toBeUndefined()
      expect(env.COLORTERM).toBe('truecolor')
      if (process.platform === 'win32') expect(Object.keys(env).some((k) => k.toLowerCase() === 'systemroot')).toBe(true)
      expect(ptyEnv({ id: 'cmd', name: 'Command Prompt', path: 'cmd.exe' }, '0.4.0').PROMPT).toContain(']633;A')
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
    }
  })

  it.runIf(process.platform === 'win32')('the prompt wrapper runs in Windows PowerShell and prints the marks', async () => {
    const out = await new Promise<string>((resolve) => {
      const p = spawnChild('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', `${__psIntegration}; prompt`], { windowsHide: true })
      let s = ''
      p.stdout.on('data', (d) => (s += d))
      p.stderr.on('data', (d) => (s += d))
      p.on('close', () => resolve(s))
    })
    expect(out).toContain('\x1b]633;A\x07')
    expect(out).toContain('\x1b]633;B\x07')
    expect(out).not.toMatch(/error|exception/i)
  })

  it.runIf(process.platform === 'win32')('in a real ConPTY, PowerShell reports the command line, start and exit code', async () => {
    const { spawn } = await import('node-pty')
    const p = spawn(pwsh.path, shellArgs(pwsh), { cols: 120, rows: 30, cwd: process.cwd(), env: ptyEnv(pwsh, 'test'), useConpty: true })
    let out = ''
    const waitFor = (re: RegExp, ms = 80_000) => new Promise<void>((resolve, reject) => {
      const t0 = Date.now()
      const tick = (): void => (re.test(out) ? resolve() : Date.now() - t0 > ms ? reject(new Error(`timed out waiting for ${re}: ${JSON.stringify(out.slice(-400))}`)) : void setTimeout(tick, 50))
      tick()
    })
    p.onData((d) => (out += d))
    try {
      await waitFor(/\x1b\]633;B\x07/)
      p.write('Write-Output dahl-ok\r')
      await waitFor(/\x1b\]633;D;0\x07/)
      expect(out).toContain('\x1b]633;E;Write-Output dahl-ok\x07')
      expect(out).toContain('\x1b]633;C\x07')
      expect(out).toContain('dahl-ok')
    } finally {
      p.kill()
    }
  }, 120_000) // PSReadLine echoes slowly while the machine is busy (measured 35 s under parallel load)
})
