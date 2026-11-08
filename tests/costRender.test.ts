import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import type { CostTally, Settings, TranscriptItem } from '@shared/types'

type Mods = {
  store: typeof import('../src/renderer/src/store')
  transcript: typeof import('../src/renderer/src/components/Transcript')
  preset: typeof import('../src/renderer/src/components/PresetSwitch')
}
let m: Mods
beforeAll(async () => {
  ;(globalThis as unknown as { window: unknown }).window ??= { dahl: {} }
  m = {
    store: await import('../src/renderer/src/store'),
    transcript: await import('../src/renderer/src/components/Transcript'),
    preset: await import('../src/renderer/src/components/PresetSwitch')
  }
})

const tally = (usd: number, requests: number): CostTally => ({ usd, requests, unknown: 0, estimated: true, inputTokens: 100_000 * requests, outputTokens: 1000 * requests, cachedTokens: 40_000, cacheWriteTokens: 0 })
const item = (p: Partial<TranscriptItem> & Pick<TranscriptItem, 'kind'>): TranscriptItem => ({ id: Math.random().toString(36).slice(2), at: '', text: '', ...p })

describe('cost in the chat', () => {
  it('the turn summary shows this request and the chat total; cost notes stay outside the folded activity list', () => {
    const items = [
      item({ kind: 'user', text: 'go' }),
      item({ kind: 'tool', text: 'list dir .', tool: { name: 'list_dir', args: '{}', ok: true } }),
      item({ kind: 'status', text: 'Large request: this step sends about 140,000 input tokens.', notice: 'cost' }),
      item({ kind: 'tool', text: 'read file a.ts', tool: { name: 'read_file', args: '{}', ok: true } }),
      item({ kind: 'status', text: 'Budget reached: this task has used $0.48 of its $0.50 limit.', notice: 'budget' }),
      item({ kind: 'summary', summary: { changedFiles: [], commands: [], toolCount: 2, durationMs: 4000, memoriesSaved: 0, revertable: false, cost: tally(0.135, 1), chatCost: tally(0.3, 3) } })
    ]
    const html = renderToString(createElement(m.transcript.Transcript, { root: 'C:/proj', items, running: false }))
    expect(html).toContain('~$0.14')
    expect(html).toContain('chat ~$0.30')
    expect(html).toMatch(/class="status-line cost-note cost reveal"[^>]*>.*Large request/)
    expect(html).toMatch(/class="status-line cost-note budget reveal"[^>]*>.*Budget reached/)
    // the two tool steps around the note render as their own activity groups (closed), not hiding the note
    expect(html.match(/class="activity /g)?.length).toBe(2)
  })

  it('the quality preset menu shows the saved preset', () => {
    m.store.useStore.setState({ settings: { qualityPreset: 'economy' } as Settings })
    const html = renderToString(createElement(m.preset.PresetSwitch))
    expect(html).toMatch(/<option value="economy" [^>]*selected=""/)
    expect(html).toContain('Balanced')
    expect(html).toContain('Best')
  })
})
