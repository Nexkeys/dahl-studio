// Key names the agent can press (browser_press), turned into CDP Input.dispatchKeyEvent fields.

export interface KeyDef {
  key: string
  code: string
  keyCode: number
  /** characters the key types (Enter types "\r"); none for navigation keys and shortcuts */
  text?: string
}

// CDP modifier bits
export const MOD = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const

const NAMED: Record<string, KeyDef> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 }
}
for (let i = 1; i <= 12; i++) NAMED[`F${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i }

const ALIAS: Record<string, string> = {
  esc: 'Escape', return: 'Enter', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', del: 'Delete',
  spacebar: 'Space', ' ': 'Space', pgup: 'PageUp', pgdn: 'PageDown', pagedown: 'PageDown', pageup: 'PageUp'
}
const MOD_ALIAS: Record<string, keyof typeof MOD> = { ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta', win: 'Meta' }

function single(ch: string, shift: boolean): KeyDef {
  const up = ch.toUpperCase()
  if (/^[a-z]$/i.test(ch)) return { key: shift ? up : ch.toLowerCase(), code: `Key${up}`, keyCode: up.charCodeAt(0), text: shift ? up : ch.toLowerCase() }
  if (/^\d$/.test(ch)) return { key: ch, code: `Digit${ch}`, keyCode: ch.charCodeAt(0), text: ch }
  return { key: ch, code: '', keyCode: 0, text: ch }
}

/**
 * "Enter", "Escape", "ArrowDown", "a", "Control+A", "Shift+Tab", "ctrl+shift+k". Null when a part is unknown.
 * Shortcuts with Control, Alt or Meta type no text.
 */
export function parseKeyCombo(input: string): { modifiers: number; key: KeyDef } | null {
  const s = String(input ?? '').trim()
  if (!s) return null
  const parts = s === '+' ? ['+'] : s.split(/\s*\+\s*/).filter(Boolean)
  if (s.endsWith('++')) parts.push('+')
  let modifiers = 0
  for (const p of parts.slice(0, -1)) {
    const m = MOD_ALIAS[p.toLowerCase()]
    if (!m) return null
    modifiers |= MOD[m]
  }
  const last = parts[parts.length - 1]
  const name = ALIAS[last.toLowerCase()] ?? Object.keys(NAMED).find((k) => k.toLowerCase() === last.toLowerCase())
  let key: KeyDef
  if (name && NAMED[name]) key = { ...NAMED[name] }
  else if ([...last].length === 1) key = single(last, (modifiers & MOD.Shift) !== 0)
  else return null
  if (modifiers & (MOD.Control | MOD.Alt | MOD.Meta)) delete key.text
  return { modifiers, key }
}
