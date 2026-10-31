import { describe, expect, it } from 'vitest'
import { stripDashes } from '../src/shared/dashes'
import { cleanModelText } from '../src/main/agent/runner'

const EM = '\u2014'
const EN = '\u2013'

describe('no em or en dashes', () => {
  it('rewrites dashes inside sentences as commas', () => {
    expect(stripDashes(`Fast ${EM} and offline.`)).toBe('Fast, and offline.')
    expect(stripDashes(`word${EM}word`)).toBe('word, word')
    expect(stripDashes(`a ${EN} b`)).toBe('a, b')
  })
  it('keeps ranges as hyphens and avoids double punctuation', () => {
    expect(stripDashes(`pages 1${EN}5 and 2020 ${EM} 2024`)).toBe('pages 1-5 and 2020-2024')
    expect(stripDashes(`done: ${EM} next`)).toBe('done: next')
  })
  it('handles dashes at the start or end of a line', () => {
    expect(stripDashes(`${EM} first\n  ${EN} second`)).toBe('- first\n  - second')
    expect(stripDashes(`Wait ${EM}\nthen go`)).toBe('Wait\nthen go')
  })
  it('leaves text without dashes and plain hyphens untouched', () => {
    const s = 'a - b -- c, x-y'
    expect(stripDashes(s)).toBe(s)
  })
  it('is applied to every model reply', () => {
    expect(cleanModelText(`Here ${EM} done`)).toBe('Here, done')
  })
})
