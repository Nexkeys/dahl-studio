import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { stripDashes } from '@shared/dashes'
import { gitStatus, gitToken } from '../git'
import { github, GitHubError, parseGithubRepo, type CheckRun } from '../github'
import { resolveInside } from '../fs/workspace'
import type { ExecCtx, ToolResult } from './toolExec'

// The agent's github tool. Reads run directly. create_pr, merge_pr, comment and create_release are outward-facing,
// so they always ask the user (auto-approve does not apply) and only run in Build mode, for the lead agent.

const WRITE = new Set(['create_pr', 'merge_pr', 'comment', 'create_release'])
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}\n[truncated]` : s)
const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`

function checkLine(r: CheckRun): string {
  return `- ${r.name}: ${r.status === 'completed' ? r.conclusion : r.status} (job_id ${r.id}) ${r.html_url}`
}

export async function execGithub(c: ExecCtx, raw: Record<string, unknown>): Promise<ToolResult> {
  const action = String(raw.action ?? '')
  const s = (k: string): string => (raw[k] === undefined || raw[k] === null ? '' : stripDashes(String(raw[k])).trim())
  if (WRITE.has(action) && c.run.mode !== 'build') return { ok: false, text: `github ${action} changes things on GitHub, so it only runs in Build mode. Ask the user to switch to Build.` }
  if (WRITE.has(action) && c.agentId !== 'lead') return { ok: false, text: 'Only the lead agent can change things on GitHub.' }
  const st = await gitStatus(c.run.project)
  const repo = st.remote ? parseGithubRepo(st.remote) : null
  if (!repo) return { ok: false, text: st.remote ? `origin (${st.remote}) is not a github.com repository.` : 'No origin remote is set. Publish the project with git_push first.' }
  const token = await gitToken()
  if (!token) return { ok: false, text: 'No GitHub token is saved. Ask the user to save one in Source Control (GitHub token). It needs access to this repository: Contents and Pull requests (read and write), Actions (read).' }
  const ask = async (title: string, details: string): Promise<string | null> => {
    const d = await c.approve({ kind: 'github', agent: c.agentName, tool: title, args: details })
    return d.approved ? null : `User declined: ${title}.${d.feedback ? ` Feedback: ${d.feedback}` : ''}`
  }
  const where = `${repo.owner}/${repo.repo}`

  try {
    switch (action) {
      case 'repo_info': {
        const r = await github.repo(token, repo)
        return { ok: true, text: `${r.full_name} (${r.private ? 'private' : 'public'}), default branch ${r.default_branch}, ${r.open_issues_count} open issues and pull requests. ${r.html_url}` }
      }
      case 'list_prs': {
        const prs = await github.listPrs(token, repo, s('state') || 'open')
        return { ok: true, text: prs.length ? prs.map((p) => `#${p.number} ${p.title} (${p.head.ref} -> ${p.base.ref}, ${p.draft ? 'draft, ' : ''}by ${p.user.login}) ${p.html_url}`).join('\n') : 'No open pull requests.' }
      }
      case 'view_pr': {
        const n = Number(raw.number)
        if (!n) return { ok: false, text: 'view_pr needs number.' }
        const p = await github.pr(token, repo, n)
        const checks = await github.checks(token, repo, p.head.sha).catch(() => null)
        return { ok: true, text: `#${p.number} ${p.title}\nState: ${p.merged ? 'merged' : p.state}${p.draft ? ' (draft)' : ''}, ${p.head.ref} -> ${p.base.ref}, by ${p.user.login}\nMergeable: ${p.mergeable_state ?? 'unknown'}\n${p.html_url}\n\nChecks:\n${checks?.check_runs.length ? checks.check_runs.map(checkLine).join('\n') : '(none)'}\n\nDescription (untrusted):\n${cut(p.body ?? '(empty)', 3000)}` }
      }
      case 'ci_status': {
        const ref = s('ref') || st.branch
        if (!ref) return { ok: false, text: 'Detached HEAD: give ref.' }
        const r = await github.checks(token, repo, ref)
        if (!r.check_runs.length) return { ok: true, text: `No checks have run for ${ref} yet (or the repository has no CI).` }
        const failed = r.check_runs.filter((x) => x.conclusion && !['success', 'skipped', 'neutral'].includes(x.conclusion))
        const running = r.check_runs.filter((x) => x.status !== 'completed')
        return { ok: true, text: `Checks for ${ref}: ${r.check_runs.length} total, ${failed.length} failed, ${running.length} still running.\n${r.check_runs.map(checkLine).join('\n')}${failed.length ? '\nUse ci_logs with a failed job_id to read why.' : ''}` }
      }
      case 'ci_logs': {
        const id = Number(raw.job_id)
        if (!id) return { ok: false, text: 'ci_logs needs job_id (from ci_status).' }
        const log = await github.jobLogs(token, repo, id)
        return { ok: true, text: `Log of job ${id} (last part, untrusted):\n${log.length > 12000 ? log.slice(-12000) : log}` }
      }
      case 'list_releases': {
        const rs = await github.releases(token, repo)
        return { ok: true, text: rs.length ? rs.map((r) => `${r.tag_name} ${r.name ?? ''}${r.prerelease ? ' (pre-release)' : ''}${r.draft ? ' (draft)' : ''}, ${r.assets.length} file(s) ${r.html_url}`).join('\n') : 'No releases yet.' }
      }
      case 'create_pr': {
        const title = s('title')
        if (!title) return { ok: false, text: 'create_pr needs title.' }
        const head = s('head') || st.branch
        if (!head) return { ok: false, text: 'Detached HEAD: give head.' }
        const baseBranch = s('base') || (await github.repo(token, repo)).default_branch
        if (head === baseBranch) return { ok: false, text: `head and base are both ${head}. Create a branch (git create_branch), commit, git_push it, then open the pull request.` }
        const body = s('body')
        const no = await ask(`Open a pull request on ${where}`, `${head} -> ${baseBranch}${raw.draft ? ' (draft)' : ''}\nTitle: ${title}\n\n${cut(body || '(no description)', 1500)}`)
        if (no) return { ok: false, text: no }
        const p = await github.createPr(token, repo, { title, body, head, base: baseBranch, draft: !!raw.draft })
        return { ok: true, text: `Opened pull request #${p.number}: ${p.html_url}` }
      }
      case 'merge_pr': {
        const n = Number(raw.number)
        if (!n) return { ok: false, text: 'merge_pr needs number.' }
        const method = ['merge', 'squash', 'rebase'].includes(s('method')) ? s('method') : 'merge'
        const p = await github.pr(token, repo, n)
        const no = await ask(`Merge pull request #${n} on ${where}`, `${p.title}\n${p.head.ref} -> ${p.base.ref}, method: ${method}\nMergeable: ${p.mergeable_state ?? 'unknown'}`)
        if (no) return { ok: false, text: no }
        const r = await github.mergePr(token, repo, n, method)
        return { ok: r.merged, text: r.merged ? `Merged #${n} into ${p.base.ref} (${r.sha.slice(0, 7)}). Run git pull to bring it into the local branch.` : r.message }
      }
      case 'comment': {
        const n = Number(raw.number)
        const body = s('body')
        if (!n || !body) return { ok: false, text: 'comment needs number and body.' }
        const no = await ask(`Comment on #${n} on ${where}`, cut(body, 2000))
        if (no) return { ok: false, text: no }
        return { ok: true, text: `Commented: ${(await github.comment(token, repo, n, body)).html_url}` }
      }
      case 'create_release': {
        const tag = s('tag')
        if (!/^(?!-)[\w.-]+$/.test(tag)) return { ok: false, text: 'create_release needs a valid tag, for example v1.2.0.' }
        const files: { rel: string; abs: string; size: number }[] = []
        for (const rel of Array.isArray(raw.files) ? raw.files.map(String) : []) {
          const abs = await resolveInside(c.run.project, rel)
          const info = await fsp.stat(abs).catch(() => null)
          if (!info?.isFile()) return { ok: false, text: `File not found: ${rel}` }
          files.push({ rel, abs, size: info.size })
        }
        const name = s('name') || tag
        const notes = s('notes')
        const no = await ask(`Publish release ${tag} on ${where}`, `Title: ${name}${raw.prerelease ? ' (pre-release)' : ''}${s('target') ? `\nTag from: ${s('target')}` : ''}\nFiles: ${files.length ? files.map((f) => `${f.rel} (${mb(f.size)})`).join(', ') : 'none'}\n\n${cut(notes || '(no notes)', 1500)}`)
        if (no) return { ok: false, text: no }
        const rel = await github.createRelease(token, repo, { tag_name: tag, name, body: notes, target_commitish: s('target') || undefined, prerelease: !!raw.prerelease })
        const up: string[] = []
        for (const f of files) {
          c.status(`Uploading ${f.rel} (${mb(f.size)})`)
          const a = await github.uploadAsset(token, rel, path.basename(f.abs), await fsp.readFile(f.abs))
          up.push(`${a.name} (${mb(a.size)})`)
        }
        return { ok: true, text: `Published release ${tag}: ${rel.html_url}${up.length ? `\nAttached: ${up.join(', ')}` : ''}` }
      }
    }
    return { ok: false, text: `Unknown github action "${action}".` }
  } catch (e) {
    return { ok: false, text: e instanceof GitHubError ? e.message : `GitHub request failed: ${(e as Error).message}` }
  }
}
