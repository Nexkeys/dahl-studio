import { describe, it, expect } from 'vitest'
import { mcpCommands, mcpSlug, parseMcpCommand } from '../src/shared/mcpCommands'

describe('MCP slash commands', () => {
  it('slugs server names', () => {
    expect(mcpSlug('sekudo')).toBe('/sekudo')
    expect(mcpSlug('Awwwards')).toBe('/awwwards')
    expect(mcpSlug('Playwright Browser')).toBe('/playwright-browser')
    expect(mcpSlug('ToolDash PDF Tools')).toBe('/tooldash-pdf-tools')
    expect(mcpSlug('  Git (local)! ')).toBe('/git-local')
    expect(mcpSlug('***')).toBe('/server')
  })

  it('lists /mcp plus enabled servers and avoids collisions', () => {
    const cmds = mcpCommands(
      [
        { id: 'a', name: 'sekudo', enabled: true },
        { id: 'b', name: 'Fix', enabled: true },
        { id: 'c', name: 'Fetch', enabled: false },
        { id: 'd', name: 'MCP', enabled: true },
        { id: 'e', name: 'fix', enabled: true }
      ],
      ['/fix', '/explain']
    )
    // enabled servers first (stable commands); disabled ones still parse so the run can say they are disabled
    expect(cmds.map((c) => c.cmd)).toEqual(['/mcp', '/sekudo', '/fix-mcp', '/mcp-mcp', '/fix-mcp2', '/fetch'])
    expect(cmds[1]).toMatchObject({ id: 'a', label: 'Use sekudo tools', enabled: true })
    expect(cmds[5]).toMatchObject({ id: 'c', enabled: false })
    expect(cmds[0].id).toBeNull()
  })

  it('parses a command at the start of a message', () => {
    const cmds = mcpCommands([{ id: 'a', name: 'sekudo', enabled: true }], [])
    expect(parseMcpCommand('/sekudo scan the site', cmds)?.id).toBe('a')
    expect(parseMcpCommand('/sekudo', cmds)?.id).toBe('a')
    expect(parseMcpCommand('/Sekudo\nscan', cmds)?.id).toBe('a')
    expect(parseMcpCommand('/mcp', cmds)?.id).toBeNull()
    expect(parseMcpCommand('/sekudox', cmds)).toBeNull()
    expect(parseMcpCommand('use /sekudo', cmds)).toBeNull()
  })
})
