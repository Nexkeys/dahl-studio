/** Slash commands for MCP servers in the chat composer (pure: shared by the renderer and tests). */

export interface McpCommand {
  cmd: string
  label: string
  /** server id; null for /mcp (all enabled servers) */
  id: string | null
  name: string
  /** disabled servers are not shown in the menu, but typing their command still reports that they are disabled */
  enabled: boolean
}

/** "/" + lowercased name with runs of non-alphanumerics as "-", e.g. "Playwright Browser" -> "/playwright-browser". */
export function mcpSlug(name: string): string {
  return `/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server'}`
}

/**
 * /mcp plus one command per server; "-mcp" (then a number) is appended when a command is already taken.
 * Enabled servers are named first so their commands do not change when a disabled one is added.
 */
export function mcpCommands(servers: { id: string; name: string; enabled: boolean }[], reserved: string[]): McpCommand[] {
  const out: McpCommand[] = [{ cmd: '/mcp', label: 'Use MCP tools (alone: list connected servers and tools)', id: null, name: 'MCP', enabled: true }]
  const taken = new Set([...reserved.map((c) => c.toLowerCase()), '/mcp'])
  for (const s of [...servers.filter((x) => x.enabled), ...servers.filter((x) => !x.enabled)]) {
    let cmd = mcpSlug(s.name)
    if (taken.has(cmd)) cmd = `${cmd}-mcp`
    for (let n = 2; taken.has(cmd); n++) cmd = `${mcpSlug(s.name)}-mcp${n}`
    taken.add(cmd)
    out.push({ cmd, label: `Use ${s.name} tools`, id: s.id, name: s.name, enabled: s.enabled })
  }
  return out
}

/** The MCP command a message starts with ("/sekudo scan the site" or just "/sekudo"), if any. */
export function parseMcpCommand(text: string, cmds: McpCommand[]): McpCommand | null {
  const m = /^(\/[\w-]+)(?:\s|$)/.exec(text.trim())
  return (m && cmds.find((c) => c.cmd === m[1].toLowerCase())) || null
}
