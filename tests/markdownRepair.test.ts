import { describe, it, expect } from 'vitest'
import { repairTables } from '../src/shared/markdownRepair'

// The exact table MiniMax produced in a user's chat (it printed as raw text)
const LIVE = '| Step | Can I do it? | Notes | |----|-------| | Write all `.tsx` / `.ts` / `.js` source files | Yes | Full app code, components, hooks, navigation | | Create `package.json`, `app.json`, config files | Yes | Standard Expo or RN templates | | Write styles, assets, native config | Yes | | | Run `npm install` / `yarn` | Maybe | Requires your approval to run a shell command |'

describe('table repair', () => {
  it('unpacks a whole table written on one line', () => {
    const out = repairTables(LIVE).split('\n')
    expect(out[0]).toBe('| Step | Can I do it? | Notes |')
    expect(out[1]).toBe('| --- | --- | --- |')
    expect(out[2]).toBe('| Write all `.tsx` / `.ts` / `.js` source files | Yes | Full app code, components, hooks, navigation |')
    expect(out[4]).toBe('| Write styles, assets, native config | Yes |  |')
    expect(out[5]).toBe('| Run `npm install` / `yarn` | Maybe | Requires your approval to run a shell command |')
    expect(out).toHaveLength(6)
  })

  it('fixes a separator row with the wrong number of cells', () => {
    expect(repairTables('| a | b | c |\n|---|---|\n| 1 | 2 | 3 |')).toBe('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |')
  })

  it('leaves correct tables, prose and code blocks alone', () => {
    const ok = '| a | b |\n|---|---|\n| 1 | 2 |'
    expect(repairTables(ok)).toBe(ok)
    const code = '```\n| a | b | c | |---|---| | 1 | 2 | 3 |\n```'
    expect(repairTables(code)).toBe(code)
    expect(repairTables('Use a | b for pipes, then -- done')).toBe('Use a | b for pipes, then -- done')
  })
})
