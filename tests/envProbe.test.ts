import { describe, it, expect } from 'vitest'
import { probeEnvironment } from '../src/main/envProbe'

describe('environment probe', () => {
  it('reports installed and missing tools quickly, and caches the answer', async () => {
    const t0 = Date.now()
    const text = await probeEnvironment()
    console.log(text, `(${Date.now() - t0} ms)`)
    expect(text).toMatch(/^Windows .* PC\. Installed: .*\. Not found: .*\.$/)
    expect(text).toMatch(/Node\.js \d+/) // this test itself runs on Node
    const t1 = Date.now()
    expect(await probeEnvironment()).toBe(text)
    expect(Date.now() - t1).toBeLessThan(50)
  })
})
