import { describe, it, expect } from 'vitest'
import { formatSnapshot, RefTable, shortUrl, type AXNode } from '../src/main/preview/snapshot'
import { RingBuffer, consoleLevel, formatConsole, formatNetwork, type ConsoleEntry, type NetEntry } from '../src/main/preview/logs'
import { agentOpenUrl, isAgentPageUrl, isLocalHttp } from '../src/main/preview/urls'
import { parseKeyCombo, MOD } from '../src/main/preview/keys'

// a small page: <nav><a>, <main><h1>, <p> with <strong>, <button>, <label>+<input>, a checkbox, hidden div
const ax = (nodeId: string, role: string, o: Partial<AXNode> = {}): AXNode => ({ nodeId, role: { type: 'role', value: role }, ...o })
const named = (v: string) => ({ type: 'computedString', value: v })
function page(): AXNode[] {
  return [
    ax('1', 'RootWebArea', { name: named('Shop'), childIds: ['2', '10'], backendDOMNodeId: 1 }),
    ax('2', 'navigation', { childIds: ['3'], backendDOMNodeId: 2, parentId: '1' }),
    ax('3', 'link', { name: named('Docs: intro'), childIds: ['4'], backendDOMNodeId: 3, properties: [{ name: 'url', value: { value: 'http://localhost:5173/docs' } }] }),
    ax('4', 'StaticText', { name: named('Docs: intro'), childIds: ['5'] }),
    ax('5', 'InlineTextBox', { name: named('Docs: intro') }),
    ax('10', 'main', { childIds: ['11', '13', '20', '30', '40', '50', '60'], backendDOMNodeId: 10 }),
    ax('11', 'heading', { name: named('Basket'), childIds: ['12'], backendDOMNodeId: 11, properties: [{ name: 'level', value: { value: 1 } }] }),
    ax('12', 'StaticText', { name: named('Basket') }),
    ax('13', 'paragraph', { childIds: ['14', '15'], backendDOMNodeId: 13 }),
    ax('14', 'StaticText', { name: named('Total:') }),
    ax('15', 'strong', { childIds: ['16'], backendDOMNodeId: 15 }),
    ax('16', 'StaticText', { name: named('12 EUR') }),
    ax('20', 'generic', { childIds: ['21'], backendDOMNodeId: 20 }),
    ax('21', 'button', { name: named('Pay now'), childIds: ['22'], backendDOMNodeId: 21, properties: [{ name: 'focusable', value: { value: true } }] }),
    ax('22', 'StaticText', { name: named('Pay now') }),
    ax('30', 'textbox', { name: named('Email'), value: { type: 'string', value: 'ada@example.com' }, backendDOMNodeId: 30, properties: [{ name: 'required', value: { value: true } }] }),
    ax('40', 'checkbox', { name: named('Gift wrap'), backendDOMNodeId: 40, properties: [{ name: 'checked', value: { value: 'true' } }, { name: 'disabled', value: { value: true } }] }),
    ax('50', 'generic', { ignored: true, childIds: ['51'], backendDOMNodeId: 50 }),
    ax('51', 'StaticText', { name: named('Shipping is free') }),
    ax('60', 'list', { childIds: ['61', '62', '63'], backendDOMNodeId: 60 }),
    ...[61, 62, 63].flatMap((i) => [ax(String(i), 'listitem', { childIds: [`${i}t`], backendDOMNodeId: i }), ax(`${i}t`, 'StaticText', { name: named(`Item ${i}`) })])
  ]
}

describe('page snapshot', () => {
  it('formats an outline with refs, flattening wrappers and merging text', () => {
    const refs = new RefTable()
    const s = formatSnapshot(page(), refs)
    expect(s.text.split('\n')).toEqual([
      '- navigation [ref=e1]',
      '  - link "Docs: intro" [ref=e2] -> http://localhost:5173/docs',
      '- main [ref=e3]',
      '  - heading "Basket" [level=1] [ref=e4]',
      '  - paragraph [ref=e5]: Total: 12 EUR',
      '  - button "Pay now" [ref=e6]',
      '  - textbox "Email" [required] [ref=e7]: ada@example.com',
      '  - checkbox "Gift wrap" [checked] [disabled] [ref=e8]',
      '  - text: Shipping is free',
      '  - list [ref=e9]',
      '    - listitem [ref=e10]: Item 61',
      '    - listitem [ref=e11]: Item 62',
      '    - listitem [ref=e12]: Item 63'
    ])
    expect(s.truncated).toBe(false)
  })

  it('maps refs to DOM nodes and keeps them stable until the page reloads', () => {
    const refs = new RefTable()
    formatSnapshot(page(), refs)
    expect(refs.node('e6')).toBe(21)
    expect(refs.node('[ref=e6]')).toBe(21)
    expect(refs.node('ref=e7')).toBe(30)
    expect(refs.node('e99')).toBeUndefined()
    // a second snapshot of a changed page keeps old refs and numbers new nodes after them
    const changed = page()
    changed.find((n) => n.nodeId === '10')!.childIds!.unshift('70')
    changed.push(ax('70', 'alert', { name: named('Saved'), backendDOMNodeId: 70 }))
    const again = formatSnapshot(changed, refs).text
    expect(again).toContain('- alert "Saved" [ref=e13]')
    expect(again).toContain('- button "Pay now" [ref=e6]')
    refs.reset()
    expect(refs.node('e6')).toBeUndefined()
  })

  it('shows one part of the page for a ref, and truncates long pages with a hint', () => {
    const refs = new RefTable()
    formatSnapshot(page(), refs)
    const part = formatSnapshot(page(), refs, { rootBackendId: refs.node('e9') })
    expect(part.text.split('\n')).toEqual(['- list [ref=e9]', '  - listitem [ref=e10]: Item 61', '  - listitem [ref=e11]: Item 62', '  - listitem [ref=e12]: Item 63'])
    const fresh = new RefTable()
    const cut = formatSnapshot(page(), fresh, { maxLines: 4 })
    expect(cut.truncated).toBe(true)
    expect(cut.text.split('\n')).toHaveLength(5)
    expect(cut.text).toMatch(/9 more line\(s\) not shown/)
    // no ref is handed out for a line that was not shown
    expect(fresh.size).toBe(4)
    const capped = formatSnapshot(page(), new RefTable(), { maxChildren: 2 })
    expect(capped.text.split('\n').slice(-1)[0]).toBe('  - ... 5 more')
  })

  it('shows link targets relative to the page', () => {
    expect(shortUrl('http://localhost:5173/docs?x=1', 'http://localhost:5173/shop/cart')).toBe('/docs?x=1')
    expect(shortUrl('http://localhost:5173/shop/cart#top', 'http://localhost:5173/shop/cart')).toBe('#top')
    expect(shortUrl('file:///C:/p/site/about.html', 'file:///C:/p/site/index.html')).toBe('about.html')
    expect(shortUrl('file:///C:/p/other.html', 'file:///C:/p/site/index.html')).toBe('file:///C:/p/other.html')
    expect(shortUrl('https://example.com/', 'http://localhost:5173/')).toBe('https://example.com/')
    expect(shortUrl('not a url', 'http://localhost/')).toBe('not a url')
    const label = [ax('1', 'RootWebArea', { childIds: ['2'] }), ax('2', 'LabelText', { childIds: ['3', '4'], backendDOMNodeId: 2 }), ax('3', 'StaticText', { name: named('Name') }), ax('4', 'textbox', { name: named('Name'), backendDOMNodeId: 4 })]
    expect(formatSnapshot(label, new RefTable()).text).toBe('- text: Name\n- textbox "Name" [ref=e1]')
  })

  it('handles empty and odd trees', () => {
    expect(formatSnapshot([], new RefTable()).text).toMatch(/no content/)
    const quotes = formatSnapshot([ax('1', 'RootWebArea', { childIds: ['2'] }), ax('2', 'button', { name: named('Say "hi"\n now'), backendDOMNodeId: 5 })], new RefTable())
    expect(quotes.text).toBe('- button "Say \\"hi\\" now" [ref=e1]')
  })
})

describe('ring buffers and logs', () => {
  it('keeps the newest entries in order and counts dropped ones', () => {
    const b = new RingBuffer<number>(3)
    for (let i = 1; i <= 5; i++) b.push(i)
    expect(b.list()).toEqual([3, 4, 5])
    expect(b.size).toBe(3)
    expect(b.dropped).toBe(2)
    b.clear()
    expect(b.list()).toEqual([])
    b.push(9)
    expect(b.list()).toEqual([9])
  })

  it('maps console levels from names and numbers', () => {
    expect([consoleLevel('error'), consoleLevel(3), consoleLevel('warning'), consoleLevel(2), consoleLevel('info'), consoleLevel(0)]).toEqual(['error', 'error', 'warning', 'warning', 'info', 'debug'])
  })

  it('lists errors and warnings by default, everything with all', () => {
    const now = 100_000
    const e: ConsoleEntry[] = [
      { at: now - 5000, level: 'info', text: 'ready' },
      { at: now - 3000, level: 'error', text: 'Uncaught TypeError: x is undefined', source: 'http://localhost:5173/src/main.ts', line: 12 },
      { at: now - 1000, level: 'warning', text: 'deprecated' }
    ]
    const t = formatConsole(e, { now })
    expect(t).toContain('1 error(s), 1 warning(s), 3 message(s)')
    expect(t).toContain('[error] Uncaught TypeError: x is undefined\n    at http://localhost:5173/src/main.ts:12 (3s ago)')
    expect(t).not.toContain('ready')
    expect(formatConsole(e, { all: true, now })).toContain('[info] ready')
    expect(formatConsole([e[0]], { now })).toMatch(/No errors or warnings/)
    expect(formatConsole([], { now })).toMatch(/Nothing was logged/)
  })

  it('lists failed and 4xx/5xx requests by default', () => {
    const now = 50_000
    const n: NetEntry[] = [
      { at: now, method: 'GET', url: 'http://localhost:5173/', type: 'Document', status: 200 },
      { at: now, method: 'GET', url: 'http://localhost:5173/api/items', type: 'Fetch', status: 500, statusText: 'Internal Server Error' },
      { at: now, method: 'GET', url: 'file:///C:/p/missing.png', type: 'Image', error: 'net::ERR_FILE_NOT_FOUND' }
    ]
    const t = formatNetwork(n, { now })
    expect(t).toContain('3 request(s), 2 failed or 4xx/5xx')
    expect(t).toContain('500 Internal Server Error  GET http://localhost:5173/api/items [Fetch]')
    expect(t).toContain('FAILED net::ERR_FILE_NOT_FOUND  GET file:///C:/p/missing.png [Image]')
    expect(t).not.toContain('[Document]')
    expect(formatNetwork(n, { all: true, now })).toContain('200  GET http://localhost:5173/ [Document]')
    expect(formatNetwork([n[0]], { now })).toMatch(/No failed requests/)
  })
})

describe('agent page rules', () => {
  const ROOT = 'C:\\Users\\me\\My Site'
  it('opens local dev servers and project files', () => {
    expect(agentOpenUrl('5173', ROOT)).toEqual({ ok: true, url: 'http://localhost:5173/' })
    expect(agentOpenUrl('localhost:3000/cart?x=1', ROOT)).toEqual({ ok: true, url: 'http://localhost:3000/cart?x=1' })
    expect(agentOpenUrl('http://127.0.0.1:8080', ROOT)).toEqual({ ok: true, url: 'http://127.0.0.1:8080/' })
    expect(agentOpenUrl('http://[::1]:4000/', ROOT).ok).toBe(true)
    expect(agentOpenUrl('index.html', ROOT)).toEqual({ ok: true, url: 'file:///C:/Users/me/My%20Site/index.html' })
    expect(agentOpenUrl('dist/index.html', ROOT)).toEqual({ ok: true, url: 'file:///C:/Users/me/My%20Site/dist/index.html' })
    expect(agentOpenUrl('C:\\Users\\me\\My Site\\a\\b.html', ROOT).ok).toBe(true)
  })
  it('refuses other sites, files outside the project and other schemes', () => {
    for (const bad of ['https://example.com', 'example.com', 'http://192.168.1.5:3000', 'http://localhost.evil.com/', 'C:\\Windows\\win.ini', 'file:///C:/Users/me/My%20Site2/index.html', '../secret.html', 'javascript:alert(1)', 'about:blank', 'data:text/html,hi', ''])
      expect(agentOpenUrl(bad, ROOT).ok, bad).toBe(false)
    expect(isLocalHttp('https://localhost:8443/')).toBe(true)
    expect(isLocalHttp('ws://localhost:5173/')).toBe(false)
    expect(isAgentPageUrl('https://example.com/', ROOT)).toBe(false)
    expect(isAgentPageUrl('file:///C:/Users/me/My%20Site/x/y.html', ROOT)).toBe(true)
    expect(isAgentPageUrl('file:///C:/Users/me/x.html', ROOT)).toBe(false)
  })
})

describe('key combos', () => {
  it('parses named keys, characters and shortcuts', () => {
    expect(parseKeyCombo('Enter')).toEqual({ modifiers: 0, key: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' } })
    expect(parseKeyCombo('esc')?.key.key).toBe('Escape')
    expect(parseKeyCombo('arrowdown')?.key.keyCode).toBe(40)
    expect(parseKeyCombo('a')?.key).toEqual({ key: 'a', code: 'KeyA', keyCode: 65, text: 'a' })
    expect(parseKeyCombo('Shift+a')?.key.text).toBe('A')
    const ctrlA = parseKeyCombo('Control+A')!
    expect(ctrlA.modifiers).toBe(MOD.Control)
    expect(ctrlA.key.text).toBeUndefined()
    expect(parseKeyCombo('ctrl+shift+k')!.modifiers).toBe(MOD.Control | MOD.Shift)
    expect(parseKeyCombo('Shift+Tab')).toEqual({ modifiers: MOD.Shift, key: { key: 'Tab', code: 'Tab', keyCode: 9 } })
    expect(parseKeyCombo('Control++')?.key.key).toBe('+')
    expect(parseKeyCombo('F5')?.key.keyCode).toBe(116)
    expect(parseKeyCombo('Hyper+x')).toBeNull()
    expect(parseKeyCombo('NotAKey')).toBeNull()
    expect(parseKeyCombo('')).toBeNull()
  })
})
