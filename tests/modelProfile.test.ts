import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compatFor, dropTuning, profileFor, samplingFor, tierGuidance, withReplay } from '../src/main/agent/modelProfile'
import { AgentRunner, type ChatBackend } from '../src/main/agent/runner'
import { DahlError } from '../src/main/dahl/client'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { ChatMessage } from '../src/shared/types'

describe('model profiles', () => {
  it('applies each family its own published sampling', () => {
    expect(profileFor('dahl:minimax-m2.7')).toMatchObject({ family: 'minimax', temperature: 1.0, topP: 0.95, topK: 40, replay: 'think_tags', tier: 'strong' })
    expect(profileFor('openrouter:qwen/qwen3-coder-480b-a35b')).toMatchObject({ family: 'qwen-coder', temperature: 0.7, topP: 0.8, topK: 20, tier: 'strong' })
    expect(profileFor('dahl:glm-5.3')).toMatchObject({ family: 'glm', temperature: 1.0, tier: 'strong' })
    expect(profileFor('nvidia:deepseek-ai/deepseek-v4-flash')).toMatchObject({ family: 'deepseek', temperature: 0.3, replay: 'reasoning_content' })
    expect(profileFor('groq:openai/gpt-oss-120b')).toMatchObject({ family: 'gpt-oss', tier: 'standard', temperature: 1.0 })
    expect(profileFor('anthropic:claude-opus-4-7').family).toBe('claude')
  })

  it('rates small and local models light, so they get stricter rules', () => {
    expect(profileFor('ollama:qwen3:8b').tier).toBe('light')
    expect(profileFor('groq:llama-3.1-8b-instant').tier).toBe('light')
    expect(profileFor('groq:llama-3.3-70b-versatile').tier).toBe('standard')
    expect(profileFor('lmstudio:some-unknown-model').tier).toBe('light')
    expect(profileFor('openai:gpt-5').tier).toBe('strong')
    expect(tierGuidance('light')).toMatch(/read_file/)
    expect(tierGuidance('strong')).toBe('')
  })

  it('leaves OpenAI, Anthropic and Gemini on their own defaults, and sends top_k only where it is accepted', () => {
    expect(samplingFor('openai:gpt-5', profileFor('openai:gpt-5'))).toEqual({})
    expect(samplingFor('gemini:gemini-3-pro', profileFor('gemini:gemini-3-pro'))).toEqual({})
    expect(samplingFor('openrouter:minimax/minimax-m2', profileFor('openrouter:minimax/minimax-m2'))).toEqual({ temperature: 1.0, topP: 0.95, topK: 40 })
    expect(samplingFor('groq:minimax-m2', profileFor('groq:minimax-m2'))).toEqual({ temperature: 1.0, topP: 0.95 })
  })

  it('sends reasoning back only inside the current tool loop, in the form the family expects', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'old', thought: 'old thinking' },
      { role: 'user', content: 'now' },
      { role: 'assistant', content: '', thought: 'plan the edit', tool_calls: [{ id: 'c', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', content: 'ok', tool_call_id: 'c' }
    ]
    const tags = withReplay(msgs, 'think_tags')
    expect(tags[1].content).toBe('old')
    expect(tags[3].content).toBe('<think>\nplan the edit\n</think>\n\n')
    expect(msgs[3].content).toBe('') // never changed in place
    expect(withReplay(msgs, 'reasoning_content')[3].reasoning_content).toBe('plan the edit')
    expect(withReplay(msgs, 'none')).toBe(msgs)
  })

  it('drops tuning once after a refusal and remembers it', () => {
    const key = 'nvidia:minimax-m2-test-drop'
    const prof = profileFor(key)
    expect(dropTuning(key, prof, [])).toBe(true)
    expect(compatFor(key).noSampling).toBe(true)
    expect(samplingFor(key, prof)).toEqual({})
    expect(dropTuning(key, prof, [])).toBe(false)
  })
})

describe('a host that refuses tuned settings', () => {
  let dir: string
  beforeEach(async () => (dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dahl-prof-'))))
  afterEach(async () => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }))

  it('retries once with provider defaults and the task still completes', async () => {
    const sent: Record<string, unknown>[] = []
    const backend: ChatBackend = {
      async chat(req) {
        sent.push({ temperature: req.temperature, topK: req.topK })
        if (req.temperature !== undefined) throw new DahlError('bad_request', 'Unsupported parameter: top_k')
        return { content: 'Hello.', reasoning: '', toolCalls: [] }
      }
    }
    const runner = new AgentRunner({ backend, getSettings: async () => DEFAULT_SETTINGS, emit: () => {}, runCommand: async () => ({ exitCode: 0, output: '', timedOut: false }), secrets: async () => [] })
    await runner.start({ project: dir, prompt: 'say hello', mode: 'review', model: 'dahl:minimax-m2-refuser' })
    while (runner.isActive(dir)) await new Promise((r) => setTimeout(r, 5))
    expect(sent[0]).toEqual({ temperature: 1.0, topK: 40 })
    expect(sent[1]).toEqual({ temperature: undefined, topK: undefined })
    expect(sent.length).toBe(2)
  })
})
