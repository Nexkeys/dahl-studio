// Pure helpers for the Preview browser, shared by the main process (request guard) and the renderer (URL field).
// No Node imports: the renderer runs sandboxed. Paths are compared case-insensitively (Windows).

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d{1,5})?([/?#].*)?$/i
const PAGE_FILE = /\.(html?|xhtml|svg)([?#].*)?$/i

/** Forward slashes, no '.', '..' or empty segments, no leading/trailing slash ("C:/a/b" or "home/a/b"). */
export function normPath(p: string): string {
  const parts: string[] = []
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      // never climb above a drive root
      if (parts.length > (/^[a-z]:$/i.test(parts[0] ?? '') ? 1 : 0)) parts.pop()
      continue
    }
    parts.push(seg)
  }
  return parts.join('/')
}

/** True when `p` is `root` or inside it. */
export function isInside(root: string, p: string): boolean {
  const a = normPath(root).toLowerCase()
  const b = normPath(p).toLowerCase()
  return !!a && (b === a || b.startsWith(`${a}/`))
}

/** file:// URL for an absolute path (each segment percent-encoded, drive letter kept). */
export function fileUrlFor(abs: string): string {
  const parts = normPath(abs).split('/')
  return `file:///${parts.map((s, i) => (i === 0 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s))).join('/')}`
}

/** Local path of a file:// URL, or null for other schemes, remote (UNC) hosts and malformed URLs. */
export function filePathFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'file:' || (u.hostname && u.hostname !== 'localhost')) return null
    const p = decodeURIComponent(u.pathname)
    return normPath(/^\/[a-z]:/i.test(p) ? p.slice(1) : p)
  } catch {
    return null
  }
}

/** Project-relative path ("site/index.html") of a file:// URL inside `root`, else null. */
export function projectRel(root: string, url: string): string | null {
  const p = filePathFromUrl(url)
  if (!p || !isInside(root, p)) return null
  return p.slice(normPath(root).length + 1)
}

/**
 * Turn what the user typed into a URL: `5173` and `localhost:5173` become http://localhost:5173/, a project file
 * like `index.html` or `dist/index.html` becomes its file:// URL, a bare domain gets https://. Null when unusable.
 */
export function normalizePreviewUrl(input: string, root: string | null): string | null {
  let s = input.trim()
  if (!s) return null
  if (/^\d{2,5}$/.test(s)) s = `http://localhost:${s}`
  else if (LOCAL_HOST.test(s)) s = `http://${s.replace(/^0\.0\.0\.0/, 'localhost')}`
  else if (/^[a-z]:[\\/]/i.test(s)) s = fileUrlFor(s)
  else if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/:]+:\d/.test(s)) {
    /* already has a scheme */
  } else if (root && PAGE_FILE.test(s) && !/^[^/\\]+\.[a-z]{2,}(:\d+)?\//i.test(s)) {
    const q = s.search(/[?#]/)
    s = fileUrlFor(`${root}/${q < 0 ? s : s.slice(0, q)}`) + (q < 0 ? '' : s.slice(q))
  } else if (/^[\w.-]+(:\d{1,5})?([/?#].*)?$/.test(s) && /[.:]/.test(s) && !PAGE_FILE.test(s.split(/[/?#]/)[0])) s = `${/:\d/.test(s) ? 'http' : 'https'}://${s}`
  else return null
  try {
    return new URL(s).href
  } catch {
    return null
  }
}

/** Pages the preview may show: any http(s) URL, and file:// URLs inside the active project. */
export function isAllowedPreviewUrl(url: string, root: string | null): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') return true
  if (u.protocol !== 'file:' || !root) return false
  const p = filePathFromUrl(url)
  return !!p && isInside(root, p)
}

/** Any request a previewed page makes (subresources, HMR sockets, inline data). */
export function isAllowedPreviewRequest(url: string, root: string | null): boolean {
  if (/^(wss?|data|blob|about|devtools):/i.test(url)) return true
  return isAllowedPreviewUrl(url, root)
}

/** First local dev-server URL printed in terminal output (ANSI colours stripped), or null. */
export function findDevServerUrl(text: string): string | null {
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  const m = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:\/[^\s'"<>`)\]]*)?/i.exec(clean)
  if (!m) return null
  const url = m[0].replace(/[.,;:!]+$/, '').replace('//0.0.0.0', '//localhost')
  try {
    return new URL(url).href
  } catch {
    return null
  }
}
