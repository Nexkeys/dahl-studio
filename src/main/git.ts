import { execFile, type ExecFileException } from 'node:child_process'
import { childEnv } from './terminal'

export interface GitFile {
  path: string
  index: string
  work: string
}

export interface GitStatus {
  repo: boolean
  branch: string | null
  ahead: number
  behind: number
  files: GitFile[]
  remote: string | null
  hasCommits: boolean
  upstream: string | null
  /** Commits on HEAD that origin does not have (as of the last fetch/push); works before an upstream is set. */
  unpushed: number
}

/** Options for remote operations. `allowLocal` is a test seam: accepts file/http remotes and applies the token to any host. */
export interface RemoteOpts {
  token?: string | null
  allowLocal?: boolean
}

export function git(cwd: string, args: string[], timeout = 30000, env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    // GIT_TERMINAL_PROMPT=0: never wait on a hidden console prompt; Git Credential Manager may still show its own sign-in window
    const cp = execFile('git', args, { cwd, windowsHide: true, timeout, maxBuffer: 20 * 1024 * 1024, env: { ...childEnv(), GIT_TERMINAL_PROMPT: '0', ...env } }, (e, out, err) => {
      const x = e as ExecFileException | null
      const missing = x?.code === 'ENOENT' ? 'Git is not installed or not on PATH. Install Git for Windows from https://git-scm.com and restart Dahl Studio.' : ''
      resolve({ code: x ? (typeof x.code === 'number' ? x.code : 1) : 0, out: String(out), err: String(err) || missing || (String(out) ? '' : x?.message ?? ''), timedOut: !!x?.killed })
    })
    cp.stdin?.end()
  })
}

const EMPTY: GitStatus = { repo: false, branch: null, ahead: 0, behind: 0, files: [], remote: null, hasCommits: false, upstream: null, unpushed: 0 }

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const r = await git(cwd, ['status', '--porcelain=v1', '-b', '-uall'])
  if (r.code !== 0) return { ...EMPTY }
  const lines = r.out.split(/\r?\n/).filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
  const hasCommits = !head.startsWith('No commits yet on ')
  const [name, up] = head.replace(/^No commits yet on /, '').split(' [')[0].split('...')
  const branch = !name || name.startsWith('HEAD (no branch)') ? null : name
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)
  const files = lines.map((l) => ({ index: l[0], work: l[1], path: l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()! }))
  const rem = await git(cwd, ['remote', 'get-url', 'origin'])
  const remote = rem.code === 0 ? rem.out.trim() : null
  let unpushed = ahead
  if (hasCommits && !up) unpushed = Number((await git(cwd, ['rev-list', '--count', 'HEAD', ...(remote ? ['--not', '--remotes=origin'] : [])])).out.trim()) || 0
  return { repo: true, branch, ahead, behind, files, remote, hasCommits, upstream: up || null, unpushed }
}

/** HEAD version of a file ('' if new). */
export async function gitShowHead(cwd: string, rel: string): Promise<string> {
  const r = await git(cwd, ['show', `HEAD:${rel.replace(/\\/g, '/')}`])
  return r.code === 0 ? r.out : ''
}

/** Commit. `skipDahl` leaves Dahl's own .dahl/ task data out (used when the agent commits before publishing). */
export async function gitCommit(cwd: string, message: string, files: string[] | 'all', skipDahl = false): Promise<string> {
  if (!message.trim()) throw new Error('Commit message is required')
  const add = await git(cwd, files === 'all' ? ['add', '-A', '--', '.', ...(skipDahl ? [':(exclude).dahl'] : [])] : ['add', '--', ...files])
  if (add.code !== 0) throw new Error(add.err || 'git add failed')
  const c = await git(cwd, ['commit', '-m', message])
  if (c.code !== 0) {
    const e = `${c.err}\n${c.out}`.trim()
    if (/nothing (added )?to commit|no changes added/i.test(e)) throw new Error('Nothing to commit: there are no changed files.')
    if (/tell me who you are|user\.email|empty ident/i.test(e)) throw new Error('Git does not know your name and email yet. Run once in a terminal:\ngit config --global user.name "Your Name"\ngit config --global user.email "you@example.com"')
    throw new Error(e || 'git commit failed')
  }
  return c.out.trim()
}

export async function gitBranch(cwd: string, name: string): Promise<string> {
  if (!/^[\w./-]+$/.test(name)) throw new Error('Invalid branch name')
  const r = await git(cwd, ['checkout', '-b', name])
  if (r.code !== 0) throw new Error(r.err.trim())
  return r.err.trim() || r.out.trim()
}

/**
 * Accepts what people paste: github.com/owner/repo, https://github.com/owner/repo/, .../repo.git, .../repo/tree/main,
 * "git clone <url>", git@github.com:owner/repo.git. Returns a clean remote URL; .git stays optional.
 */
export function normalizeRemoteUrl(input: string, allowLocal = false): string {
  let u = input.trim().replace(/^git\s+clone\s+/i, '').replace(/^["'<]+|["'>]+$/g, '').trim()
  if (!u) throw new Error('Remote URL is empty')
  if (/^[\w.-]+@[\w.-]+:[^\\]/.test(u) || /^ssh:\/\//i.test(u)) return u.replace(/\/+$/, '')
  u = u.replace(/^http:\/\/((www\.)?github\.com\/)/i, 'https://$1').replace(/^((www\.)?github\.com\/)/i, 'https://$1')
  if (allowLocal && !/^https:\/\//i.test(u)) return u
  if (!/^https:\/\/[^\s/]+\/\S+$/i.test(u)) throw new Error('Remote must look like https://github.com/owner/repo (or git@github.com:owner/repo.git)')
  let url: URL
  try {
    url = new URL(u)
  } catch {
    throw new Error('Remote URL is not valid')
  }
  if (url.password) throw new Error('Do not put a password or token in the remote URL. Save a GitHub token in Source Control instead.')
  if (/^(www\.)?github\.com$/i.test(url.hostname)) {
    const [owner, repo] = url.pathname.split('/').filter(Boolean)
    if (!owner || !repo) throw new Error('A GitHub link needs the owner and repository: https://github.com/owner/repo')
    return `https://github.com/${owner}/${repo}`
  }
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

export const isGithubHttps = (url: string | null): boolean => !!url && /^https:\/\/([^@/]+@)?(www\.)?github\.com\//i.test(url)

// Token auth: reset all configured helpers (Git Credential Manager etc.) for this one command and add a helper that
// prints the token from the environment. The token never appears in process arguments, .git/config or the remote URL.
const TOKEN_HELPER = '!f() { test "$1" = get && echo username=x-access-token && echo "password=$DAHL_GIT_TOKEN"; }; f'
let tokenSource: () => Promise<string | null> = async () => null
/** Main process wiring: where the saved GitHub token comes from (encrypted vault). */
export function setGitTokenSource(fn: () => Promise<string | null>): void {
  tokenSource = fn
}
export const gitTokenSaved = async (): Promise<boolean> => !!(await tokenSource().catch(() => null))
/** The saved GitHub token, for the GitHub API (agent github tool). Never logged or sent anywhere but GitHub. */
export const gitToken = (): Promise<string | null> => tokenSource().catch(() => null)

/** Run a git command that talks to `url`; uses the saved token for https://github.com remotes, else the user's credential helper. */
export async function remoteGit(cwd: string, url: string, args: string[], o: RemoteOpts = {}) {
  const token = o.token !== undefined ? o.token : await tokenSource().catch(() => null)
  const useToken = !!token && (isGithubHttps(url) || !!o.allowLocal)
  // without a token GCM may open a sign-in window; give the user time to finish it, but never wait forever
  const r = await git(cwd, useToken ? ['-c', 'credential.helper=', '-c', `credential.helper=${TOKEN_HELPER}`, ...args] : args, useToken ? 120000 : 300000, useToken ? { DAHL_GIT_TOKEN: token! } : {})
  const scrub = (s: string) => (token && token.length >= 4 ? s.split(token).join('[REDACTED]') : s)
  return { ...r, out: scrub(r.out), err: scrub(r.err), usedToken: useToken }
}

/** Turn git's remote errors into a clear next step. */
export function explainRemoteError(raw: string, ctx: { url: string; branch: string; usedToken: boolean; timedOut?: boolean }): string {
  const e = raw.trim()
  let m: string
  if (ctx.timedOut) m = 'Timed out talking to the remote. If a Git Credential Manager sign-in window opened, finish signing in and try again, or save a GitHub token in Source Control.'
  else if (/src refspec .* does not match any/i.test(e)) m = `Nothing to push: branch "${ctx.branch}" has no commits yet. Commit your files first.`
  else if (/\[rejected\]|fetch first|non-fast-forward|\(stale info\)/i.test(e)) m = `Push rejected: the remote already has commits that are not in your local branch (for example a README or licence created on GitHub). Dahl Studio never force-pushes. Bring them in first, then push again:\ngit pull origin ${ctx.branch} --allow-unrelated-histories\n(resolve any conflicts and commit).`
  else if (/protected branch|GH006/i.test(e)) m = `The remote protects branch "${ctx.branch}". Push to another branch and open a pull request.`
  else if (/repository .* not found|Repository not found|does not appear to be a git repository|\b404\b/i.test(e)) m = `Repository not found at ${ctx.url}. Check the link, create the repository on GitHub first (Dahl Studio cannot create it), and make sure your account${ctx.usedToken ? ' and token' : ''} can access it.`
  else if (/Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission to .* denied|\b40[13]\b|invalid credentials|Cannot prompt because/i.test(e))
    m = ctx.usedToken
      ? 'GitHub rejected the saved token. Check that it has not expired and has write access to this repository (fine-grained: Contents read and write; classic: repo scope).'
      : 'Not signed in to GitHub. Save a personal access token in Source Control, or sign in once with Git Credential Manager (run "git push" in a terminal).'
  else if (/Could not resolve host|Failed to connect|unable to access|timed out/i.test(e)) m = 'Could not reach the remote. Check your internet connection and the URL.'
  else return e || 'git command failed'
  return e ? `${m}\n\nGit said: ${e.split('\n').filter((l) => !/^hint:/.test(l)).slice(0, 6).join('\n')}` : m
}

export async function gitInitOrRemote(cwd: string, remoteUrl?: string, o: RemoteOpts & { inspect?: boolean } = {}): Promise<string> {
  const st = await gitStatus(cwd)
  if (!st.repo) {
    // GitHub's default branch is main; older Git defaults to master, which would land beside main on the remote
    let r = await git(cwd, ['init', '-b', 'main'])
    if (r.code !== 0) r = await git(cwd, ['init'])
    if (r.code !== 0) throw new Error(r.err)
  }
  if (!remoteUrl) return 'Repository initialised.'
  const url = normalizeRemoteUrl(remoteUrl, o.allowLocal)
  const has = await git(cwd, ['remote', 'get-url', 'origin'])
  const r = await git(cwd, has.code === 0 ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url])
  if (r.code !== 0) throw new Error(r.err)
  if (o.inspect === false) return `Remote set to ${url}.`
  const ls = await remoteGit(cwd, url, ['ls-remote', '--heads', 'origin'], o)
  if (ls.code !== 0) return `Remote set to ${url}, but it could not be reached yet: ${explainRemoteError(ls.err, { url, branch: st.branch ?? 'main', usedToken: ls.usedToken, timedOut: ls.timedOut }).split('\n')[0]}`
  const n = ls.out.split('\n').filter(Boolean).length
  return `Remote set to ${url}. ${n ? `It has ${n} branch(es); if they contain commits you do not have, pull before pushing.` : 'It is empty and ready for your first push.'}`
}

/** What a push would do, without touching the network. Used for the approval card and the Push confirmation. */
export async function pushPlan(cwd: string, branch?: string) {
  const st = await gitStatus(cwd)
  const local = st.branch
  const target = (branch || local || '').trim()
  if (target && !/^[\w./-]+$/.test(target)) throw new Error('Invalid branch name')
  const tracked = target ? await git(cwd, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${target}`]) : null
  const commits = !st.hasCommits ? 0 : tracked?.code === 0 ? Number((await git(cwd, ['rev-list', '--count', `origin/${target}..HEAD`])).out.trim()) || 0 : st.unpushed
  return { repo: st.repo, remote: st.remote, branch: local, target, hasCommits: st.hasCommits, commits, pending: st.files.length }
}

/** Push the current branch (to `branch` on origin if given) with -u. Never force-pushes. */
export async function gitPush(cwd: string, o: RemoteOpts & { branch?: string } = {}): Promise<string> {
  const p = await pushPlan(cwd, o.branch)
  if (!p.repo) throw new Error('This folder is not a Git repository yet. Initialise it and set a remote first.')
  if (!p.remote) throw new Error('No remote set. Paste your GitHub repository link (https://github.com/owner/repo) and set it as the remote first.')
  if (!p.branch) throw new Error('You are not on a branch (detached HEAD). Check out a branch before pushing.')
  if (!p.hasCommits) throw new Error(`Nothing to push: branch "${p.branch}" has no commits yet. Commit your files first.`)
  const ctx = { url: p.remote, branch: p.target, usedToken: false }
  const r = await remoteGit(cwd, p.remote, ['push', '-u', 'origin', `${p.branch}:refs/heads/${p.target}`], o)
  if (r.code !== 0) throw new Error(explainRemoteError(r.err || r.out, { ...ctx, usedToken: r.usedToken, timedOut: r.timedOut }))
  let msg = `Pushed ${p.branch} to ${p.remote} (${p.target}).`
  if (/\[new branch\]/.test(r.err)) {
    const head = await remoteGit(cwd, p.remote, ['ls-remote', '--symref', 'origin', 'HEAD'], o)
    const def = /ref: refs\/heads\/(\S+)\s+HEAD/.exec(head.out)?.[1]
    if (def && def !== p.target) msg += `\nNote: the remote's default branch is "${def}", so this created a separate branch "${p.target}". To publish into "${def}", pull it and push to "${def}" instead.`
  }
  return `${msg}\n${r.err.trim()}`.trim()
}

/** Check the remote is reachable with the current credentials (read access; push permission is only checked by pushing). */
export async function gitCheckRemote(cwd: string, o: RemoteOpts = {}): Promise<string> {
  const st = await gitStatus(cwd)
  if (!st.remote) throw new Error('No remote set.')
  const r = await remoteGit(cwd, st.remote, ['ls-remote', '--heads', 'origin'], o)
  if (r.code !== 0) throw new Error(explainRemoteError(r.err, { url: st.remote, branch: st.branch ?? 'main', usedToken: r.usedToken, timedOut: r.timedOut }))
  return `Can reach ${st.remote}${r.usedToken ? ' with the saved token' : ''} (${r.out.split('\n').filter(Boolean).length} branch(es)).`
}

/** Validate a GitHub token against the GitHub API (direct to api.github.com; the token is never sent anywhere else). */
export async function testGithubToken(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'DahlStudio' }, signal: AbortSignal.timeout(15000) })
  if (res.status === 401) throw new Error('GitHub rejected this token (wrong, expired or revoked).')
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}.`)
  const u = (await res.json()) as { login?: string }
  const scopes = res.headers.get('x-oauth-scopes')
  return `Token works for GitHub user ${u.login ?? '?'}${scopes !== null ? ` (scopes: ${scopes || 'none'})` : ''}.`
}
