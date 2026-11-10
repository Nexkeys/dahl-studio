// Which pages the agent may drive in the Preview pane. The pane itself shows any http(s) page the user types; the
// agent is held to this machine (local dev servers) and files inside the task's project.
import { isAllowedPreviewUrl, normalizePreviewUrl } from '@shared/preview'

const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i

/** http(s) served from this machine: localhost, 127.0.0.1, 0.0.0.0 or [::1], any port. */
export function isLocalHttp(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL.test(u.hostname)
  } catch {
    return false
  }
}

/** True when the agent may read and act on this page: a local dev server, or a file inside the project. */
export function isAgentPageUrl(url: string, root: string): boolean {
  if (isLocalHttp(url)) return true
  return /^file:/i.test(url) && isAllowedPreviewUrl(url, root)
}

/**
 * What the model passed to browser_open, as a URL it may open. Accepts the same short forms as the Preview address
 * bar: `5173`, `localhost:3000/path`, `index.html`, `dist/index.html`, an absolute path inside the project.
 */
export function agentOpenUrl(input: string, root: string): { ok: true; url: string } | { ok: false; error: string } {
  const url = normalizePreviewUrl(String(input ?? ''), root)
  if (!url) return { ok: false, error: `"${input}" is not a URL or page file. Use a dev server address (5173, localhost:3000) or an HTML file in the project (index.html).` }
  if (!isAgentPageUrl(url, root))
    return { ok: false, error: `browser_open only opens local dev servers (localhost, 127.0.0.1) and HTML files inside this project; ${url} is neither. Use web_fetch for other web pages.` }
  return { ok: true, url }
}
