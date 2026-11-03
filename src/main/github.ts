// GitHub REST client for the agent's github tool. Requests go straight from this PC to api.github.com (and
// uploads.github.com for release files) with the user's saved token; there is no Dahl server in between.

export interface Repo {
  owner: string
  repo: string
}

/** owner/repo from an origin URL (https or ssh), or null when it is not a github.com remote. */
export function parseGithubRepo(url: string): Repo | null {
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? { owner: m[1], repo: m[2] } : null
}

export class GitHubError extends Error {}

function explain(status: number, data: { message?: string; errors?: { message?: string; code?: string; field?: string }[] } | null): string {
  const detail = [data?.message, ...(data?.errors ?? []).map((e) => e.message ?? [e.field, e.code].filter(Boolean).join(' '))].filter(Boolean).join('; ')
  if (status === 401) return 'GitHub rejected the saved token (wrong, expired or revoked). Save a new one in Source Control.'
  if (status === 403) return `GitHub refused this (403). The token may lack permission for it (fine-grained tokens need Contents, Pull requests and Actions access for this repository), or the rate limit was hit.${detail ? ` GitHub said: ${detail}` : ''}`
  if (status === 404) return 'Not found on GitHub. Check the repository, number or tag, and that the token can access this repository.'
  if (status === 405 || status === 409) return `GitHub could not do this right now: ${detail || `HTTP ${status}`}. For a merge, the pull request may have conflicts, failing required checks or need reviews.`
  return `GitHub answered HTTP ${status}${detail ? `: ${detail}` : ''}.`
}

export async function ghRequest<T>(token: string, method: string, url: string, body?: unknown, o: { raw?: Buffer; contentType?: string; timeoutMs?: number; text?: boolean } = {}): Promise<T> {
  const full = url.startsWith('https://') ? url : `https://api.github.com${url}`
  const res = await fetch(full, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DahlStudio',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(o.raw ? { 'Content-Type': o.contentType ?? 'application/octet-stream' } : {})
    },
    body: o.raw ? new Uint8Array(o.raw) : body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(o.timeoutMs ?? 30000)
  })
  if (o.text && res.ok) return (await res.text()) as T
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) throw new GitHubError(explain(res.status, data as never))
  return data as T
}

export interface PullRequest {
  number: number; title: string; state: string; draft: boolean; html_url: string; body: string | null; user: { login: string }
  head: { ref: string; sha: string }; base: { ref: string }; mergeable?: boolean | null; mergeable_state?: string; merged?: boolean; updated_at: string
}
export interface CheckRun { id: number; name: string; status: string; conclusion: string | null; html_url: string }
export interface Release { id: number; tag_name: string; name: string | null; html_url: string; upload_url: string; draft: boolean; prerelease: boolean; published_at: string | null; assets: { name: string; size: number }[] }

const base = (r: Repo): string => `/repos/${r.owner}/${r.repo}`

export const github = {
  repo: (t: string, r: Repo) => ghRequest<{ full_name: string; default_branch: string; private: boolean; html_url: string; open_issues_count: number }>(t, 'GET', base(r)),
  listPrs: (t: string, r: Repo, state = 'open') => ghRequest<PullRequest[]>(t, 'GET', `${base(r)}/pulls?state=${encodeURIComponent(state)}&per_page=20`),
  pr: (t: string, r: Repo, n: number) => ghRequest<PullRequest>(t, 'GET', `${base(r)}/pulls/${n}`),
  createPr: (t: string, r: Repo, p: { title: string; body: string; head: string; base: string; draft: boolean }) => ghRequest<PullRequest>(t, 'POST', `${base(r)}/pulls`, p),
  mergePr: (t: string, r: Repo, n: number, method: string) => ghRequest<{ merged: boolean; message: string; sha: string }>(t, 'PUT', `${base(r)}/pulls/${n}/merge`, { merge_method: method }),
  comment: (t: string, r: Repo, n: number, body: string) => ghRequest<{ html_url: string }>(t, 'POST', `${base(r)}/issues/${n}/comments`, { body }),
  checks: (t: string, r: Repo, ref: string) => ghRequest<{ total_count: number; check_runs: CheckRun[] }>(t, 'GET', `${base(r)}/commits/${encodeURIComponent(ref)}/check-runs?per_page=50`),
  // GitHub answers with a redirect to a signed URL; fetch drops the Authorization header on that cross-host redirect
  jobLogs: (t: string, r: Repo, id: number) => ghRequest<string>(t, 'GET', `${base(r)}/actions/jobs/${id}/logs`, undefined, { text: true, timeoutMs: 60000 }),
  releases: (t: string, r: Repo) => ghRequest<Release[]>(t, 'GET', `${base(r)}/releases?per_page=10`),
  createRelease: (t: string, r: Repo, p: { tag_name: string; name: string; body: string; target_commitish?: string; prerelease: boolean }) => ghRequest<Release>(t, 'POST', `${base(r)}/releases`, { ...p, draft: false }),
  uploadAsset: (t: string, rel: Release, name: string, data: Buffer) =>
    ghRequest<{ name: string; size: number; browser_download_url: string }>(t, 'POST', `${rel.upload_url.split('{')[0]}?name=${encodeURIComponent(name)}`, undefined, { raw: data, timeoutMs: 15 * 60 * 1000 })
}
