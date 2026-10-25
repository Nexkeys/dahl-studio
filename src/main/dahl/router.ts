import type { KeyInfo, KeySlot, KeyUsageLocal } from '@shared/types'
import { DahlError, estimateTokens, streamChat, type ChatRequest, type ChatResult, type FetchLike, type StreamCallbacks } from './client'

export interface RouterDeps {
  getKey(slot: KeySlot): Promise<string | null>
  getPreferred(): Promise<'primary' | 'secondary'>
  onUsage?(slot: KeySlot, u: Partial<KeyUsageLocal> & { ok: boolean }): void
  onHealth?(slot: KeySlot, health: KeyInfo['health'], error?: string): void
  sleep?(ms: number): Promise<void>
  fetchImpl?: FetchLike
}

/** Errors that mean "this key cannot serve requests right now" -> try the other key immediately. */
const SWITCH_KEY: DahlError['kind'][] = ['auth', 'exhausted', 'rate_key']
/** Transient errors -> bounded retry with backoff on the same key, then fail over. */
const RETRY: DahlError['kind'][] = ['server', 'timeout', 'network', 'rate_model']
export const MAX_RETRIES_PER_KEY = 2

export function otherSlot(s: 'primary' | 'secondary'): 'primary' | 'secondary' {
  return s === 'primary' ? 'secondary' : 'primary'
}

export interface RoutedResult extends ChatResult {
  slot: KeySlot
  attempts: number
}

/**
 * Sends a chat request using the preferred key, failing over to the other key on eligible failures.
 * Never fails over after the stream has started producing output (that would duplicate output),
 * and never retries invalid requests (400 / model unavailable / context length).
 */
export class DahlRouter {
  constructor(private deps: RouterDeps) {}

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise((r) => setTimeout(r, ms))
  }

  async chat(req: ChatRequest, signal: AbortSignal, cb: StreamCallbacks = {}): Promise<RoutedResult> {
    const preferred = await this.deps.getPreferred()
    const order: KeySlot[] = []
    for (const s of [preferred, otherSlot(preferred)] as KeySlot[]) if (await this.deps.getKey(s)) order.push(s)
    if (!order.length) throw new DahlError('auth', 'No Dahl API key configured. Add one in Settings > API Keys.')

    let lastErr: DahlError | null = null
    let attempts = 0
    for (const slot of order) {
      const key = (await this.deps.getKey(slot))!
      for (let retry = 0; retry <= MAX_RETRIES_PER_KEY; retry++) {
        attempts++
        let started = false
        const t0 = Date.now()
        try {
          const res = await streamChat(
            key,
            req,
            signal,
            {
              onFirstByte: () => {
                started = true
                cb.onFirstByte?.()
              },
              onDelta: (t) => {
                started = true
                cb.onDelta?.(t)
              },
              onReasoning: (t) => {
                started = true
                cb.onReasoning?.(t)
              }
            },
            this.deps.fetchImpl
          )
          const promptText = JSON.stringify(req.messages)
          const reported = !!res.usage && typeof res.usage.prompt_tokens === 'number'
          this.deps.onUsage?.(slot, {
            ok: true,
            promptTokens: reported ? res.usage!.prompt_tokens! : estimateTokens(promptText),
            completionTokens: reported
              ? res.usage!.completion_tokens ?? 0
              : estimateTokens(res.content + res.reasoning + JSON.stringify(res.toolCalls)),
            estimated: !reported,
            lastModel: req.model,
            lastLatencyMs: Date.now() - t0
          })
          this.deps.onHealth?.(slot, 'ok')
          return { ...res, slot, attempts }
        } catch (e) {
          const err = e instanceof DahlError ? e : new DahlError('network', String(e))
          if (err.kind === 'cancelled') throw err
          lastErr = err
          this.deps.onUsage?.(slot, { ok: false, lastModel: req.model, lastLatencyMs: Date.now() - t0 })
          if (started) throw err
          if (SWITCH_KEY.includes(err.kind)) {
            this.deps.onHealth?.(slot, err.kind === 'auth' ? 'auth_failed' : err.kind === 'exhausted' ? 'exhausted' : 'rate_limited', err.message)
            break // next key
          }
          if (RETRY.includes(err.kind)) {
            if (retry < MAX_RETRIES_PER_KEY) {
              const backoff = Math.min(err.retryAfterMs ?? 1000 * 2 ** retry, 10_000)
              await this.sleep(backoff)
              if (signal.aborted) throw new DahlError('cancelled', 'Request cancelled')
              continue
            }
            this.deps.onHealth?.(slot, err.kind === 'rate_model' ? 'rate_limited' : 'error', err.message)
            break // next key
          }
          throw err // bad_request, model_unavailable, context_length: do not retry or switch
        }
      }
    }
    throw lastErr ?? new DahlError('network', 'Request failed')
  }
}
