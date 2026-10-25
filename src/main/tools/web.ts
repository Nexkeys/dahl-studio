/**
 * Built-in, keyless web research.
 * - webSearch: DuckDuckGo's HTML endpoint (the same backend the duckduckgo-mcp-server uses). No API key or account.
 * - webFetch: download a page and convert HTML to readable text.
 * Retrieved content is untrusted data and is labelled as such for the model.
 */

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 DahlStudio'

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

export function parseDuckDuckGoHtml(html: string, max = 8): SearchResult[] {
  const out: SearchResult[] = []
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < max) {
    let url = decodeEntities(m[1])
    const uddg = /[?&]uddg=([^&]+)/.exec(url)
    if (uddg) url = decodeURIComponent(uddg[1])
    if (url.startsWith('//')) url = 'https:' + url
    if (/duckduckgo\.com\/y\.js|ad_provider/.test(url)) continue // skip ads
    out.push({ title: stripTags(m[2]), url, snippet: stripTags(m[3] ?? m[4] ?? '') })
  }
  return out
}

export async function webSearch(query: string, signal?: AbortSignal, max = 8): Promise<SearchResult[]> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({ q: query, kl: 'wt-wt' }).toString(),
    signal: signal ?? AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`DuckDuckGo returned HTTP ${res.status}${res.status === 202 || res.status === 429 ? ' (rate limited, try again shortly)' : ''}`)
  return parseDuckDuckGoHtml(await res.text(), max)
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  let body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  const main = /<(main|article)[^>]*>([\s\S]*?)<\/\1>/i.exec(body)
  if (main && main[2].length > 500) body = main[2]
  body = body
    .replace(/<(h[1-6])[^>]*>/gi, '\n\n## ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|p|div|tr|section|header|footer|pre|blockquote)[^>]*>/gi, '\n')
    .replace(/<a[^>]+href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => `${stripTags(t)} (${href})`)
  const text = decodeEntities(body.replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l, i, a) => l || (a[i - 1] ?? '') !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title, text }
}

export async function webFetch(url: string, signal?: AbortSignal, maxChars = 24000): Promise<{ url: string; status: number; title: string; text: string; truncated: boolean }> {
  const u = new URL(url)
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https URLs can be fetched')
  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: signal ?? AbortSignal.timeout(25000) })
  const ctype = res.headers.get('content-type') ?? ''
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 5 * 1024 * 1024) throw new Error('Page is larger than 5 MB')
  const raw = buf.toString('utf8')
  const { title, text } = ctype.includes('html') ? htmlToText(raw) : { title: '', text: raw }
  return { url: res.url, status: res.status, title, text: text.slice(0, maxChars), truncated: text.length > maxChars }
}
