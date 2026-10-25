import { execFile } from 'node:child_process'
import { childEnv } from './terminal'

export interface GitFile {
  path: string
  index: string
  work: string
}

export function git(cwd: string, args: string[], timeout = 30000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, timeout, maxBuffer: 20 * 1024 * 1024, env: { ...childEnv(), GIT_TERMINAL_PROMPT: '0' } }, (e, out, err) => {
      resolve({ code: e ? ((e as NodeJS.ErrnoException & { code?: number }).code as unknown as number) || 1 : 0, out: String(out), err: String(err) })
    })
  })
}

export async function gitStatus(cwd: string): Promise<{ repo: boolean; branch: string | null; ahead: number; behind: number; files: GitFile[]; remote: string | null }> {
  const r = await git(cwd, ['status', '--porcelain=v1', '-b', '-uall'])
  if (r.code !== 0) return { repo: false, branch: null, ahead: 0, behind: 0, files: [], remote: null }
  const lines = r.out.split(/\r?\n/).filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
  const branch = head.split('...')[0].replace(/^No commits yet on /, '') || null
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)
  const files = lines.map((l) => ({ index: l[0], work: l[1], path: l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()! }))
  const rem = await git(cwd, ['remote', 'get-url', 'origin'])
  return { repo: true, branch, ahead, behind, files, remote: rem.code === 0 ? rem.out.trim() : null }
}

/** HEAD version of a file ('' if new). */
export async function gitShowHead(cwd: string, rel: string): Promise<string> {
  const r = await git(cwd, ['show', `HEAD:${rel.replace(/\\/g, '/')}`])
  return r.code === 0 ? r.out : ''
}

export async function gitCommit(cwd: string, message: string, files: string[] | 'all'): Promise<string> {
  if (!message.trim()) throw new Error('Commit message is required')
  const add = await git(cwd, files === 'all' ? ['add', '-A'] : ['add', '--', ...files])
  if (add.code !== 0) throw new Error(add.err || 'git add failed')
  const c = await git(cwd, ['commit', '-m', message])
  if (c.code !== 0) throw new Error((c.err || c.out).trim() || 'git commit failed')
  return c.out.trim()
}

export async function gitBranch(cwd: string, name: string): Promise<string> {
  if (!/^[\w./-]+$/.test(name)) throw new Error('Invalid branch name')
  const r = await git(cwd, ['checkout', '-b', name])
  if (r.code !== 0) throw new Error(r.err.trim())
  return r.err.trim() || r.out.trim()
}

/** Push the current branch. Never force-pushes. Uses the user's existing Git credentials (credential manager). */
export async function gitPush(cwd: string): Promise<string> {
  const st = await gitStatus(cwd)
  if (!st.branch) throw new Error('No branch to push')
  const r = await git(cwd, ['push', '-u', 'origin', st.branch], 120000)
  if (r.code !== 0) {
    const e = r.err.trim()
    if (/rejected|non-fast-forward|fetch first/i.test(e)) throw new Error(`Push rejected: the remote has commits you do not have. Pull and merge first (Dahl Studio never force-pushes).\n${e}`)
    if (/Authentication|could not read Username|403|denied/i.test(e)) throw new Error(`Authentication failed. Sign in with Git Credential Manager (run "git push" once in a terminal) or configure a token.\n${e}`)
    throw new Error(e || 'git push failed')
  }
  return (r.err || r.out).trim()
}

export async function gitInitOrRemote(cwd: string, remoteUrl?: string): Promise<string> {
  const st = await gitStatus(cwd)
  if (!st.repo) {
    const r = await git(cwd, ['init'])
    if (r.code !== 0) throw new Error(r.err)
  }
  if (remoteUrl) {
    if (!/^(https:\/\/|git@)/.test(remoteUrl)) throw new Error('Remote must be an https:// or git@ URL')
    const has = await git(cwd, ['remote', 'get-url', 'origin'])
    const r = await git(cwd, has.code === 0 ? ['remote', 'set-url', 'origin', remoteUrl] : ['remote', 'add', 'origin', remoteUrl])
    if (r.code !== 0) throw new Error(r.err)
    const ls = await git(cwd, ['ls-remote', '--heads', 'origin'], 60000)
    return ls.code === 0 ? `Remote set. Remote has ${ls.out.split('\n').filter(Boolean).length} branch(es).` : `Remote set, but it could not be inspected: ${ls.err.trim()}`
  }
  return 'Repository initialised.'
}
