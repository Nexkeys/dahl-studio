import { createHash } from 'node:crypto'
import type { ChatMessage, CompletionRequest, CompletionResponse, Settings } from '@shared/types'
import { DahlError, type FetchLike } from '../dahl/client'
import { buildPrompt, pickStrategy, splitKey, type BuiltPrompt, type Strategy } from './prompt'
import { cleanCompletion } from './clean'
import { chatParams, fakeCompletion, fimRequest, type Endpoint } from './transport'

export interface CompletionDeps {
  getSettings(): Promise<Pick<Settings, 'tabCompletions' | 'completionModel'>>
  /** a chat call through the model registry (every provider, with its own key and usage accounting) */
  chat(req: { model: string; messages: ChatMessage[]; temperature?: number; extra?: Record<string, unknown> }, signal: AbortSignal): Promise<{ content: string }>
  /** base URL and key of a provider, for FIM endpoints */
  endpoint(provider: string): Promise<Endpoint>
  fetch?: FetchLike
  /** serve "fake:" models (smoke and dev runs only) */
  allowFake?: boolean
  now?: () => number
}

export const LIMITS = {
  /** model calls per rolling minute: typing asks at most once per 250 ms pause, this caps long bursts */
  perMinute: 30,
  timeoutMs: 10_000,
  cacheSize: 200,
  /** how long to stop asking after auth or quota errors, rate limits, or several failures in a row */
  pauseAuthMs: 60_000,
  pauseRateMs: 15_000,
  pauseFailMs: 30_000,
  failuresBeforePause: 3
}

function cacheKey(model: string, path: string, p: BuiltPrompt): string {
  return createHash('sha1').update([model, path, p.singleLine ? '1' : '0', p.prefix, p.suffix].join('\u0000')).digest('hex')
}

/**
 * Tab completions in the main process: one small model call per pause in typing. Sends nothing while the feature
 * is off or no completion model is chosen. Answers are cached by the text around the cursor, only the newest request
 * is kept (older ones are aborted), calls are rate limited, and errors pause the feature for a while instead of
 * failing on every keystroke.
 */
export class CompletionService {
  private cache = new Map<string, string>()
  private inflight = new Map<number, AbortController>()
  private calls: number[] = []
  private pausedUntil = 0
  private pauseReason = ''
  private failures = 0
  /** models whose server refused a FIM request: they get the chat prompt instead */
  private noFim = new Set<string>()

  constructor(private deps: CompletionDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  cancel(id: number): void {
    this.inflight.get(id)?.abort()
    this.inflight.delete(id)
  }

  /** for tests and the indicator: requests still waiting for a model */
  get pending(): number {
    return this.inflight.size
  }

  async request(req: CompletionRequest): Promise<CompletionResponse> {
    const s = await this.deps.getSettings()
    if (!s.tabCompletions) return { skipped: 'off' }
    const model = s.completionModel
    if (!model) return { skipped: 'no_model' }
    let strategy = pickStrategy(model, this.noFim)
    if (strategy.kind === 'fake' && !this.deps.allowFake) return { error: 'Test completion models only work in development runs. Choose a real model in Settings.' }
    // only the newest request matters: older ones are for text that has changed since
    for (const id of [...this.inflight.keys()]) if (id !== req.id) this.cancel(id)

    const t0 = this.now()
    const { provider, id } = splitKey(model)
    let built = buildPrompt(req, strategy, id)
    const key = cacheKey(model, req.path, built)
    const hit = this.cache.get(key)
    if (hit !== undefined && !req.explicit) {
      this.cache.delete(key)
      this.cache.set(key, hit)
      return { text: hit, cached: true, ms: 0 }
    }
    if (!req.explicit && t0 < this.pausedUntil) return { skipped: 'paused', error: this.pauseReason }
    this.calls = this.calls.filter((t) => t0 - t < 60_000)
    if (!req.explicit && this.calls.length >= LIMITS.perMinute) return { skipped: 'rate_limited' }
    this.calls.push(t0)

    const ctrl = new AbortController()
    this.inflight.set(req.id, ctrl)
    let timedOut = false
    const timer = setTimeout(() => ((timedOut = true), ctrl.abort()), LIMITS.timeoutMs)
    try {
      let raw: string
      try {
        raw = await this.send(strategy, model, provider, id, built, ctrl.signal)
      } catch (e) {
        // a server that will not do FIM for this model (Ollama: "does not support insert"): use the chat prompt
        if (!(e instanceof DahlError && e.kind === 'bad_request' && strategy.kind === 'suffix-fim') || ctrl.signal.aborted) throw e
        this.noFim.add(model)
        strategy = { kind: 'chat' }
        built = buildPrompt(req, strategy, id)
        raw = await this.send(strategy, model, provider, id, built, ctrl.signal)
      }
      const text = cleanCompletion(raw, built)
      this.remember(key, text)
      this.failures = 0
      return { text, cached: false, ms: this.now() - t0 }
    } catch (e) {
      if (timedOut) return { error: this.fail(new DahlError('timeout', `The completion model did not answer within ${LIMITS.timeoutMs / 1000} s.`)) }
      if (ctrl.signal.aborted || (e instanceof DahlError && e.kind === 'cancelled')) return { skipped: 'cancelled' }
      return { error: this.fail(e) }
    } finally {
      clearTimeout(timer)
      if (this.inflight.get(req.id) === ctrl) this.inflight.delete(req.id)
    }
  }

  private async send(strategy: Strategy, model: string, provider: string, id: string, built: BuiltPrompt, signal: AbortSignal): Promise<string> {
    if (strategy.kind === 'fake') return fakeCompletion(built, signal)
    if (strategy.kind === 'chat') {
      const { extra, temperature } = chatParams(provider, id, built)
      return (await this.deps.chat({ model, messages: built.messages ?? [], temperature, extra }, signal)).content
    }
    return fimRequest(this.deps.fetch ?? fetch, await this.deps.endpoint(provider), strategy, id, built, signal)
  }

  private remember(key: string, text: string): void {
    this.cache.set(key, text)
    if (this.cache.size > LIMITS.cacheSize) this.cache.delete(this.cache.keys().next().value!)
  }

  /** Readable error; auth, quota and rate-limit errors (and repeated failures) pause completions for a while. */
  private fail(e: unknown): string {
    const err = e instanceof DahlError ? e : new DahlError('network', (e as Error)?.message ?? String(e))
    let pause = 0
    if (err.kind === 'auth' || err.kind === 'exhausted' || err.kind === 'model_unavailable') pause = LIMITS.pauseAuthMs
    else if (err.kind === 'rate_key' || err.kind === 'rate_model') pause = Math.max(LIMITS.pauseRateMs, err.retryAfterMs ?? 0)
    else if (++this.failures >= LIMITS.failuresBeforePause) pause = LIMITS.pauseFailMs
    if (!pause) return err.message
    this.failures = 0
    this.pausedUntil = this.now() + pause
    this.pauseReason = `${err.message} (Tab completions paused for ${Math.round(pause / 1000)} s)`
    return this.pauseReason
  }
}
