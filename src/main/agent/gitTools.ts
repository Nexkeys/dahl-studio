import { promises as fsp } from 'node:fs'
import type { Settings } from '@shared/types'
import { stripDashes } from '@shared/dashes'
import { explainRemoteError, git, gitCommit, gitStatus, normalizeRemoteUrl, remoteGit } from '../git'
import { resolveInside } from '../fs/workspace'
import type { ExecCtx, ToolResult } from './toolExec'
import { autoApproved } from './approvals'

// The agent's git tool. Read actions run directly; everything that changes the repository is lead-only, Build-only and
// approved like a command. There is no force, reset --hard or history rewrite. Remote actions use the saved GitHub
// token (never in args or URLs) so they cannot hang on a hidden credential prompt.

const READ = new Set(['status', 'diff', 'log', 'branches', 'show', 'fetch'])
const WRITE = new Set(['pull', 'create_branch', 'switch', 'merge', 'merge_abort', 'commit', 'stash', 'stash_pop', 'tag', 'clone'])
const REF = /^(?!-)[\w./@{}~^:-]+$/
const NAME = /^(?!-)(?!.*\.\.)(?!.*\/\/)[\w./-]+(?<![./])$/
const cut = (s: string, n = 12000): string => (s.length > n ? `${s.slice(0, n)}\n[truncated: ${s.length - n} more characters]` : s)
const out = (r: { out: string; err: string }): string => `${r.out}${r.err ? `\n${r.err}` : ''}`.trim()

async function conflicted(root: string): Promise<string[]> {
  return (await git(root, ['diff', '--name-only', '--diff-filter=U'])).out.split(/\r?\n/).filter(Boolean)
}

/** What the approval card shows: the git command this action runs. */
function describe(action: string, a: Record<string, string | boolean | string[] | undefined>, branch: string | null): string {
  const q = (v: unknown) => (String(v).includes(' ') ? `"${v}"` : String(v))
  switch (action) {
    case 'pull': return `git pull ${a.rebase ? '--rebase' : '--no-rebase'} origin ${a.ref || branch}`
    case 'create_branch': return `git switch -c ${a.name}${a.ref ? ` ${a.ref}` : ''}`
    case 'switch': return `git switch ${a.ref}`
    case 'merge': return `git merge --no-edit ${a.ref}`
    case 'merge_abort': return 'git merge --abort'
    case 'commit': return `git add ${Array.isArray(a.files) && a.files.length ? a.files.join(' ') : '-A'}; git commit -m ${q(a.message)}`
    case 'stash': return `git stash push -u${a.message ? ` -m ${q(a.message)}` : ''}`
    case 'stash_pop': return 'git stash pop'
    case 'tag': return `git tag ${a.message ? `-a ${a.name} -m ${q(a.message)}` : a.name}${a.ref ? ` ${a.ref}` : ''}`
    case 'clone': return `git clone ${a.url} ${a.dir}`
    default: return `git ${action}`
  }
}

export async function execGit(c: ExecCtx, raw: Record<string, unknown>, settings: Settings): Promise<ToolResult> {
  const root = c.run.project
  const action = String(raw.action ?? '')
  const a = {
    ref: raw.ref ? String(raw.ref).trim() : '', name: raw.name ? String(raw.name).trim() : '', path: raw.path ? String(raw.path) : '',
    message: raw.message ? stripDashes(String(raw.message)).trim() : '', files: Array.isArray(raw.files) ? raw.files.map(String) : [],
    staged: !!raw.staged, rebase: !!raw.rebase, url: raw.url ? String(raw.url) : '', dir: raw.dir ? String(raw.dir) : ''
  }
  if (a.ref && !REF.test(a.ref)) return { ok: false, text: `Invalid ref "${a.ref}".` }
  if (a.name && !NAME.test(a.name)) return { ok: false, text: `Invalid branch or tag name "${a.name}".` }
  if (!READ.has(action)) {
    if (!WRITE.has(action)) return { ok: false, text: `Unknown git action "${action}".` }
    if (c.run.mode !== 'build') return { ok: false, text: `git ${action} changes the repository, so it only runs in Build mode. Ask the user to switch to Build.` }
    if (c.agentId !== 'lead') return { ok: false, text: `Only the lead agent can run git ${action}. Report back instead.` }
  }
  const st = await gitStatus(root)
  if (!st.repo && action !== 'clone') return { ok: false, text: 'This project is not a Git repository yet. Use git_push to initialise and publish it.' }
  const pathArgs = a.path ? ['--', a.path] : []

  switch (action) {
    case 'status': {
      const conf = await conflicted(root)
      const track = st.upstream ? `tracking ${st.upstream}, ahead ${st.ahead}, behind ${st.behind}` : st.remote ? `not tracking a remote branch, ${st.unpushed} unpushed commit(s)` : 'no remote'
      return { ok: true, text: `Branch ${st.branch ?? '(detached HEAD)'}, ${track}.\n${st.files.length ? st.files.map((f) => `${f.index}${f.work} ${f.path}`).join('\n') : 'Working tree clean.'}${conf.length ? `\nUnresolved conflicts: ${conf.join(', ')}` : ''}` }
    }
    case 'diff': {
      const base = ['diff', ...(a.staged ? ['--staged'] : []), ...(a.ref ? [a.ref] : [])]
      const [stat, patch] = await Promise.all([git(root, [...base, '--stat', ...pathArgs]), git(root, [...base, ...pathArgs])])
      if (patch.code !== 0) return { ok: false, text: out(patch) }
      return { ok: true, text: patch.out.trim() ? cut(`${stat.out.trim()}\n\n${patch.out}`) : 'No differences.' }
    }
    case 'log': {
      const n = Math.min(Math.max(Number(raw.count) || 15, 1), 100)
      const r = await git(root, ['log', `-n${n}`, '--date=short', '--pretty=format:%h %ad %an%d %s', ...(a.ref ? [a.ref] : []), ...pathArgs])
      return { ok: r.code === 0, text: r.code === 0 ? r.out.trim() || 'No commits yet.' : out(r) }
    }
    case 'branches': {
      const r = await git(root, ['branch', '-a', '-vv', '--no-color'])
      return { ok: r.code === 0, text: out(r) || 'No branches yet.' }
    }
    case 'show': {
      const r = await git(root, ['show', '--stat', '--patch', a.ref || 'HEAD'])
      return { ok: r.code === 0, text: cut(out(r)) }
    }
    case 'fetch': {
      if (!st.remote) return { ok: false, text: 'No remote is set (origin).' }
      const r = await remoteGit(root, st.remote, ['fetch', '--prune', 'origin'])
      if (r.code !== 0) return { ok: false, text: explainRemoteError(r.err || r.out, { url: st.remote, branch: st.branch ?? 'main', usedToken: r.usedToken, timedOut: r.timedOut }) }
      const after = await gitStatus(root)
      return { ok: true, text: `Fetched origin.${after.upstream ? ` ${after.branch} is ahead ${after.ahead}, behind ${after.behind} of ${after.upstream}.` : ''}\n${r.err.trim()}`.trim() }
    }
  }

  if (action === 'pull' && !st.remote) return { ok: false, text: 'No remote is set (origin), so there is nothing to pull from.' }
  if (action === 'pull' && !st.branch && !a.ref) return { ok: false, text: 'Detached HEAD: switch to a branch first, or give ref.' }
  if ((action === 'create_branch' || action === 'tag') && !a.name) return { ok: false, text: `git ${action} needs name.` }
  if ((action === 'switch' || action === 'merge') && !a.ref) return { ok: false, text: `git ${action} needs ref (the branch).` }
  if (action === 'commit' && !a.message) return { ok: false, text: 'git commit needs message.' }
  if (action === 'clone' && (!a.url || !a.dir)) return { ok: false, text: 'git clone needs url and dir (a new folder inside the project).' }

  const command = describe(action, a, st.branch)
  if (!autoApproved(settings, 'command')) {
    const d = await c.approve({ kind: 'command', agent: c.agentName, command, reason: raw.reason ? String(raw.reason) : undefined })
    if (!d.approved) return { ok: false, text: `User declined: ${command}.${d.feedback ? ` Feedback: ${d.feedback}` : ''}` }
  }
  const done = (ok: boolean, text: string): ToolResult => {
    c.turn.commands.push({ command, exitCode: ok ? 0 : 1 })
    c.run.commandsRun.push({ command, exitCode: ok ? 0 : 1 })
    c.onChanged()
    return { ok, text }
  }
  const withConflicts = async (r: { code: number; out: string; err: string }, what: string): Promise<ToolResult> => {
    if (r.code === 0) return done(true, out(r) || `${what} done.`)
    const conf = await conflicted(root)
    if (conf.length) return done(false, `${what} stopped with conflicts in: ${conf.join(', ')}.\nRead each file, resolve the <<<<<<< / ======= / >>>>>>> markers with edit_file, then git commit. Or git merge_abort to undo.`)
    return done(false, out(r))
  }

  switch (action) {
    case 'pull': {
      const r = await remoteGit(root, st.remote!, ['pull', a.rebase ? '--rebase' : '--no-rebase', '--no-edit', 'origin', a.ref || st.branch!])
      if (r.code !== 0 && !(await conflicted(root)).length && /fatal|error/i.test(r.err)) return done(false, explainRemoteError(r.err, { url: st.remote!, branch: a.ref || st.branch!, usedToken: r.usedToken, timedOut: r.timedOut }))
      return withConflicts(r, 'Pull')
    }
    case 'create_branch': return withConflicts(await git(root, ['switch', '-c', a.name, ...(a.ref ? [a.ref] : [])]), `Created and switched to ${a.name}.`)
    case 'switch': return withConflicts(await git(root, ['switch', a.ref]), `Switched to ${a.ref}.`)
    case 'merge': return withConflicts(await git(root, ['merge', '--no-edit', ...(a.message ? ['-m', a.message] : []), a.ref]), 'Merge')
    case 'merge_abort': return withConflicts(await git(root, ['merge', '--abort']), 'Merge aborted.')
    case 'commit':
      try {
        return done(true, await gitCommit(root, a.message, a.files.length ? a.files : 'all'))
      } catch (e) {
        return done(false, (e as Error).message)
      }
    case 'stash': return withConflicts(await git(root, ['stash', 'push', '-u', ...(a.message ? ['-m', a.message] : [])]), 'Stashed.')
    case 'stash_pop': return withConflicts(await git(root, ['stash', 'pop']), 'Stash applied')
    case 'tag': return withConflicts(await git(root, ['tag', ...(a.message ? ['-a', a.name, '-m', a.message] : [a.name]), ...(a.ref ? [a.ref] : [])]), `Tagged ${a.name}.`)
    case 'clone': {
      const url = normalizeRemoteUrl(a.url)
      const abs = await resolveInside(root, a.dir)
      if (await fsp.stat(abs).then(() => true, () => false)) return done(false, `${a.dir} already exists. Choose a new folder.`)
      const r = await remoteGit(root, url, ['clone', url, abs])
      return done(r.code === 0, r.code === 0 ? `Cloned ${url} into ${a.dir}.` : explainRemoteError(r.err, { url, branch: 'main', usedToken: r.usedToken, timedOut: r.timedOut }))
    }
  }
  return { ok: false, text: `Unknown git action "${action}".` }
}
