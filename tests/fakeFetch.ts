// Test helpers: a fake fetch that answers by URL, and response builders (JSON, SSE, NDJSON).

export type Route = (init?: RequestInit) => Response | Promise<Response>

/** Routes are exact URLs, or a prefix ending in "*". Unknown URLs fail like a server that is not running. */
export function fakeFetch(routes: Record<string, Route>, seen: { url: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init })
    const key = Object.keys(routes).find((k) => url === k || (k.endsWith('*') && url.startsWith(k.slice(0, -1))))
    if (!key) throw new TypeError(`fetch failed (no route for ${url})`)
    return routes[key](init)
  }) as unknown as typeof fetch
}

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** An SSE body; strings are sent as-is after "data: ", except lines starting with ":" (comments) which are sent raw. */
export function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => (typeof c === 'string' && c.startsWith(':') ? `${c}\n\n` : `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`)).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

export const ndjson = (lines: unknown[]): Response => new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
