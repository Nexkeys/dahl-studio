import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { explainRemoteError, git, gitCheckRemote, gitCommit, gitInitOrRemote, gitPush, gitStatus, normalizeRemoteUrl, pushPlan } from '../src/main/git'
import { execTool, type ExecCtx } from '../src/main/agent/toolExec'
import { toolsFor } from '../src/main/agent/tools'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { PendingApproval } from '../src/shared/types'

// Each test starts dozens of real git processes. On Windows (Defender scanning every spawn) one test took 36 s while
// the rest of the suite ran in parallel, so the default 5 s limit made `npm run dist` fail at random.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

// Everything runs against temporary local repositories; nothing talks to GitHub.
const L = { allowLocal: true, token: null }
let dir: string
beforeAll(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' })
})
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-git-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 })
})

async function sh(cwd: string, ...args: string[]): Promise<string> {
  const r = await git(cwd, args)
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.err}`)
  return r.out.trim()
}
async function bare(name: string, readme = false): Promise<string> {
  const b = path.join(dir, name)
  await sh(dir, 'init', '--bare', '-b', 'main', b)
  if (readme) {
    const seed = path.join(dir, `${name}-seed`)
    await sh(dir, 'init', '-b', 'main', seed)
    await fs.writeFile(path.join(seed, 'README.md'), '# created on GitHub\n')
    await sh(seed, 'add', '-A')
    await sh(seed, 'commit', '-m', 'Initial commit')
    await sh(seed, 'push', b, 'main')
  }
  return b
}
async function project(branch = 'main', files: Record<string, string> = { 'index.js': 'console.log(1)\n' }): Promise<string> {
  const p = path.join(dir, 'proj')
  await fs.mkdir(p, { recursive: true })
  for (const [f, c] of Object.entries(files)) await fs.writeFile(path.join(p, f), c)
  await sh(p, 'init', '-b', branch)
  return p
}

describe('remote URL normalisation', () => {
  it('accepts the forms people paste', () => {
    for (const u of ['github.com/owner/repo', 'https://github.com/owner/repo', 'https://github.com/owner/repo/', 'http://github.com/owner/repo', 'www.github.com/owner/repo', 'https://github.com/owner/repo/tree/main/src', 'git clone https://github.com/owner/repo', ' <https://github.com/owner/repo?tab=readme> '])
      expect(normalizeRemoteUrl(u)).toBe('https://github.com/owner/repo')
    expect(normalizeRemoteUrl('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo.git')
    expect(normalizeRemoteUrl('github.com/owner/repo.git/')).toBe('https://github.com/owner/repo.git')
    expect(normalizeRemoteUrl('git@github.com:owner/repo.git')).toBe('git@github.com:owner/repo.git')
    expect(normalizeRemoteUrl('https://gitlab.com/group/sub/repo.git/')).toBe('https://gitlab.com/group/sub/repo.git')
  })
  it('rejects local paths, missing repo names and embedded tokens in production', () => {
    expect(() => normalizeRemoteUrl('C:\\repos\\x.git')).toThrow(/https:\/\/github.com/)
    expect(() => normalizeRemoteUrl('file:///C:/x.git')).toThrow()
    expect(() => normalizeRemoteUrl('https://github.com/owner')).toThrow(/owner and repository/)
    expect(() => normalizeRemoteUrl('https://user:ghp_secret123@github.com/o/r')).toThrow(/token/)
    expect(() => normalizeRemoteUrl('')).toThrow()
  })
})

describe('GitView path against local bare repositories', () => {
  it('brand-new folder: initialises on main and refuses to push without commits', async () => {
    const p = path.join(dir, 'fresh')
    await fs.mkdir(p)
    expect((await gitStatus(p)).repo).toBe(false)
    await gitInitOrRemote(p)
    const st = await gitStatus(p)
    expect(st).toMatchObject({ repo: true, branch: 'main', hasCommits: false, remote: null })
    await gitInitOrRemote(p, await bare('empty.git'), L)
    await expect(gitPush(p, L)).rejects.toThrow(/no commits yet/)
  })

  it('commits but no remote: clear error', async () => {
    const p = await project()
    await gitCommit(p, 'first', 'all')
    await expect(gitPush(p, L)).rejects.toThrow(/No remote set/)
    await expect(gitCommit(p, 'again', 'all')).rejects.toThrow(/Nothing to commit/)
  })

  it('first push to an empty remote sets upstream; ahead counts update', async () => {
    const p = await project()
    await gitCommit(p, 'first', 'all')
    const b = await bare('empty.git')
    expect(await gitInitOrRemote(p, b, L)).toMatch(/empty and ready/)
    expect((await gitStatus(p)).unpushed).toBe(1)
    expect((await pushPlan(p)).commits).toBe(1)
    expect(await gitPush(p, L)).toMatch(/^Pushed main/)
    const st = await gitStatus(p)
    expect(st).toMatchObject({ upstream: 'origin/main', ahead: 0, unpushed: 0 })
    expect(await sh(b, 'rev-parse', 'main')).toBe(await sh(p, 'rev-parse', 'HEAD'))
    await fs.writeFile(path.join(p, 'b.js'), 'x\n')
    await gitCommit(p, 'second', 'all')
    expect((await gitStatus(p)).ahead).toBe(1)
    expect((await pushPlan(p)).commits).toBe(1)
  })

  it('remote with unrelated commits (README): rejected, never forced, remote untouched', async () => {
    const p = await project()
    await gitCommit(p, 'mine', 'all')
    const b = await bare('readme.git', true)
    const before = await sh(b, 'rev-parse', 'main')
    expect(await gitInitOrRemote(p, b, L)).toMatch(/1 branch/)
    const err = await gitPush(p, L).catch((e: Error) => e.message)
    expect(err).toMatch(/Push rejected/)
    expect(err).toMatch(/never force-pushes/)
    expect(err).toMatch(/git pull origin main --allow-unrelated-histories/)
    expect(await sh(b, 'rev-parse', 'main')).toBe(before)
  })

  it('local master vs remote main: warns that a separate branch was created; branch option targets main', async () => {
    const p = await project('master')
    await gitCommit(p, 'mine', 'all')
    const b = await bare('readme.git', true)
    await gitInitOrRemote(p, b, { ...L, inspect: false })
    expect(await gitPush(p, L)).toMatch(/default branch is "main", so this created a separate branch "master"/)
    await expect(gitPush(p, { ...L, branch: 'main' })).rejects.toThrow(/Push rejected/)
    await expect(gitPush(p, { ...L, branch: 'bad name' })).rejects.toThrow(/Invalid branch/)
  })

  it('explains auth and not-found errors', () => {
    const ctx = { url: 'https://github.com/o/r', branch: 'main', usedToken: false }
    expect(explainRemoteError("fatal: could not read Username for 'https://github.com': terminal prompts disabled", ctx)).toMatch(/Not signed in to GitHub/)
    expect(explainRemoteError('remote: Permission to o/r.git denied to x.\nfatal: unable to access: The requested URL returned error: 403', { ...ctx, usedToken: true })).toMatch(/rejected the saved token/)
    expect(explainRemoteError("remote: Repository not found.\nfatal: repository 'https://github.com/o/r/' not found", ctx)).toMatch(/Repository not found at https:\/\/github.com\/o\/r/)
    expect(explainRemoteError('', { ...ctx, timedOut: true })).toMatch(/Git Credential Manager sign-in window/)
  })
})

/** Smart-HTTP git server (git http-backend) that requires Basic auth with `token` as the password. */
function httpGitServer(root: string, token: string): Promise<{ url: string; seen: string[]; close: () => void }> {
  const seen: string[] = []
  const srv = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? ''
    seen.push(auth)
    if (!auth.startsWith('Basic ') || Buffer.from(auth.slice(6), 'base64').toString().split(':').slice(1).join(':') !== token) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' })
      return void res.end()
    }
    const u = new URL(req.url ?? '/', 'http://x')
    const cgi = spawn('git', ['http-backend'], { windowsHide: true, env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: decodeURIComponent(u.pathname), QUERY_STRING: u.search.slice(1), REQUEST_METHOD: req.method ?? 'GET', CONTENT_TYPE: String(req.headers['content-type'] ?? ''), REMOTE_USER: 'test', REMOTE_ADDR: '127.0.0.1', HTTP_CONTENT_ENCODING: String(req.headers['content-encoding'] ?? ''), HTTP_GIT_PROTOCOL: String(req.headers['git-protocol'] ?? '') } })
    req.pipe(cgi.stdin)
    let buf = Buffer.alloc(0)
    let started = false
    cgi.stdout.on('data', (d: Buffer) => {
      if (started) return void res.write(d)
      buf = Buffer.concat([buf, d])
      const i = buf.indexOf('\r\n\r\n')
      if (i < 0) return
      let status = 200
      const hs: Record<string, string> = {}
      for (const l of buf.subarray(0, i).toString().split('\r\n')) {
        const [k, ...v] = l.split(':')
        if (k.toLowerCase() === 'status') status = parseInt(v.join(':'))
        else hs[k] = v.join(':').trim()
      }
      res.writeHead(status, hs)
      started = true
      res.write(buf.subarray(i + 4))
    })
    cgi.on('close', () => res.end())
  })
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, seen, close: () => srv.close() })))
}

describe('token authentication', () => {
  const TOKEN = 'github_pat_TESTTOKEN0123456789abcdef'
  it('pushes with the token via a one-shot credential helper; token never in output, config or args', async () => {
    const p = await project()
    await gitCommit(p, 'first', 'all')
    await bare('srv.git')
    const s = await httpGitServer(dir, TOKEN)
    try {
      await gitInitOrRemote(p, `${s.url}/srv.git`, { allowLocal: true, token: TOKEN, inspect: false })
      expect(await gitCheckRemote(p, { allowLocal: true, token: TOKEN })).toMatch(/with the saved token/)
      const out = await gitPush(p, { allowLocal: true, token: TOKEN })
      expect(out).toMatch(/^Pushed main/)
      expect(out).not.toContain(TOKEN)
      expect(s.seen.some((h) => h.startsWith('Basic '))).toBe(true)
      const cfg = await fs.readFile(path.join(p, '.git', 'config'), 'utf8')
      expect(cfg).not.toContain(TOKEN)
      expect(cfg).not.toMatch(/credential/)
      expect(await sh(path.join(dir, 'srv.git'), 'rev-parse', 'main')).toBe(await sh(p, 'rev-parse', 'HEAD'))
      // wrong token: clear auth error, fails fast (helper list reset, so no Credential Manager window), token not echoed
      const bad = 'github_pat_WRONG000000000000000000'
      const err = await gitPush(p, { allowLocal: true, token: bad, branch: 'other' }).catch((e: Error) => e.message)
      expect(err).toMatch(/rejected the saved token/)
      expect(err).not.toContain(bad)
    } finally {
      s.close()
    }
  })
})

describe('git_push agent tool', () => {
  it('is offered to the lead in Build mode only', () => {
    expect(toolsFor('lead', 'build', false)).toContain('git_push')
    expect(toolsFor('lead', 'plan', false)).not.toContain('git_push')
    expect(toolsFor('implementer', 'build', false)).not.toContain('git_push')
  })

  it('always asks (even with auto-approve on), showing remote, branch and commits; nothing changes when declined', async () => {
    const p = await project()
    await gitCommit(p, 'first', 'all')
    const asked: Omit<PendingApproval, 'id' | 'runId' | 'project'>[] = []
    const ctx = {
      run: { project: p, mode: 'build', commandsRun: [] },
      deps: { getSettings: async () => ({ ...DEFAULT_SETTINGS, autoApproveCommands: true, autoApproveWrites: true }), secrets: async () => [] },
      agentName: 'Dahl',
      approve: async (x: Omit<PendingApproval, 'id' | 'runId' | 'project'>) => (asked.push(x), { approved: false, feedback: 'not now' }),
      status: () => {}
    } as unknown as ExecCtx
    const r = await execTool(ctx, 'git_push', JSON.stringify({ remote_url: 'github.com/owner/repo/' }), ['git_push'])
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/declined.*not now/)
    expect(asked[0]).toMatchObject({ kind: 'push', push: { remote: 'https://github.com/owner/repo', branch: 'main', target: 'main', commits: 1 } })
    expect((await gitStatus(p)).remote).toBeNull()
    const none = await execTool(ctx, 'git_push', '{}', ['git_push'])
    expect(none.text).toMatch(/No remote is set/)
    const bad = await execTool(ctx, 'git_push', JSON.stringify({ remote_url: 'C:\\evil' }), ['git_push'])
    expect(bad.ok).toBe(false)
  })
})
