// Tolerant tool-argument parsing. Weaker models often send values in the wrong JSON shape: an array or object as a
// JSON string ({"agents": "[{...}]"}, seen live from MiniMax M2.7), numbers and booleans as strings, a single object
// where a list is expected, code fences around the JSON, or a trailing comma. Each is repaired against the tool's
// JSON schema, so the tool receives the shape it declares. Genuinely truncated JSON is still rejected.

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; items?: Schema; [k: string]: unknown }

export type ParsedArgs = { ok: true; args: Record<string, any> } | { ok: false; error: string }

const TRUNCATED = 'Your tool call arguments were not valid JSON - most likely the output was cut off because it was too long. Split large content: create the file with write_file (under ~250 lines), then add the rest with append_file in several calls.'

function tryJson(s: string): { ok: true; v: unknown } | { ok: false } {
  try {
    return { ok: true, v: JSON.parse(s) }
  } catch {
    return { ok: false }
  }
}

/** Parse the raw arguments string, allowing code fences and trailing commas. */
function parseLoose(raw: string): { ok: true; v: unknown } | { ok: false } {
  const text = (raw || '').trim() || '{}'
  const direct = tryJson(text)
  if (direct.ok) return direct
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  // trailing commas before a closing bracket (outside strings this is never valid JSON, so the repair is safe to try)
  return tryJson(unfenced.replace(/,\s*([}\]])/g, '$1'))
}

const typeOf = (s?: Schema): string | undefined => (Array.isArray(s?.type) ? s!.type.find((t) => t !== 'null') : s?.type)

/** Coerce a value towards the schema's declared type. Values that cannot be coerced are returned unchanged. */
export function coerce(value: unknown, schema?: Schema): unknown {
  const t = typeOf(schema)
  if (!schema || !t) return value
  if ((t === 'array' || t === 'object') && typeof value === 'string') {
    const s = value.trim()
    if ((t === 'array' && s.startsWith('[')) || (t === 'object' && s.startsWith('{'))) {
      const p = parseLoose(s)
      if (p.ok) value = p.v
    } else if (t === 'array' && s.startsWith('{')) {
      const p = parseLoose(s)
      if (p.ok && p.v && typeof p.v === 'object') value = [p.v]
    }
  }
  if (t === 'array') {
    if (value && typeof value === 'object' && !Array.isArray(value)) value = [value]
    if (Array.isArray(value)) return value.map((v) => coerce(v, schema.items))
    return value
  }
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !schema.properties) return value
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
    for (const [k, sub] of Object.entries(schema.properties)) if (k in out) out[k] = coerce(out[k], sub)
    return out
  }
  if ((t === 'integer' || t === 'number') && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    const n = Number(value)
    return t === 'integer' ? Math.trunc(n) : n
  }
  if (t === 'boolean' && typeof value === 'string' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true'
  return value
}

/** Parse and repair tool arguments against the tool's parameters schema (if known). */
export function parseToolArgs(raw: string, schemaIn?: unknown): ParsedArgs {
  const schema = schemaIn as Schema | undefined
  const p = parseLoose(raw)
  if (!p.ok) return { ok: false, error: TRUNCATED }
  let v = p.v
  // some models wrap the whole object in a string
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    const inner = parseLoose(v)
    if (inner.ok) v = inner.v
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Tool arguments must be a JSON object with the named parameters.' }
  const fixed = coerce(v, schema ? { ...schema, type: 'object' } : undefined) as Record<string, any>
  return { ok: true, args: fixed }
}
