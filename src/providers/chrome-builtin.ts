// Chrome built-in translation (DESIGN §8.4; Phase 0 measurements in RESEARCH §6): offline, no key, 10–20 ms per sentence.
// The only fallback engine requiring neither network nor payment. `Translator` is also exposed in isolated worlds (2026-09-05, RESEARCH §6.3).
//
// Hard rule 4: free interfaces are unstable; classify errors separately and allow fallback to the next engine.
import { toBcp47 } from '@/config/languages'
import { ProviderError, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'

/** Only two static methods are needed; injectable for tests (happy-dom lacks this global). */
export interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>
  create(options: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal; monitor?: (m: unknown) => void }): Promise<TranslatorSession>
}

export interface TranslatorSession {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>
}

export interface ChromeBuiltinDeps {
  /** Defaults to global `Translator`; missing means this browser does not support it. */
  translator?: TranslatorApi | null
  /** Independent session-creation timeout, injectable for tests. */
  createTimeoutMs?: number
}

export const BUILTIN_SOURCE_LANGUAGE = 'en'

/** Maximum concurrent inference calls; also the provider's declared maxBatchItems. */
export const BUILTIN_MAX_ITEMS = 20

/**
 * Independent session-creation timeout. Even after the model is ready, create() takes about 8.6s to load locally (RESEARCH §6.1).
 * 60s leaves ample headroom. This gate is required because the shared session Promise **uses no batch signal**:
 * otherwise a create() that never returns would stay cached forever, with every retry waiting on the same dead Promise
 * (Codex #50).
 */
export const SESSION_CREATE_TIMEOUT_MS = 60_000

/**
 * Minimal semaphore. Local inference concurrency must be limited **across calls**: maxBatchItems is 20,
 * and the queue can dispatch multiple batches at once, producing hundreds of concurrent calls to one local model.
 * Splitting within each call controls only that call, not the total (Codex #50).
 */
export function createSemaphore(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []
  const acquire = (): Promise<void> => {
    if (active < limit) {
      active++
      return Promise.resolve()
    }
    // release transfers the permit directly; a woken waiter must not increment the count again.
    // Decrementing before waking leaves a microtask gap where new arrivals also take the slot, exceeding the limit (Codex #50).
    return new Promise<void>(resolve => waiting.push(resolve))
  }
  const release = (): void => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
  return async function withPermit<T>(fn: () => Promise<T>): Promise<T> {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

function globalTranslator(): TranslatorApi | null {
  const api = (globalThis as { Translator?: TranslatorApi }).Translator
  return api && typeof api.availability === 'function' ? api : null
}

/**
 * Extra spaces after CJK punctuation: the model translates sentences separately and joins them with spaces, e.g. "。 我们".
 * See RESEARCH §6.2. This normalization belongs to the engine, not protector: the placeholder protocol does not handle typographic spacing.
 */
export function normalizeSpacing(text: string): string {
  return text.replace(/([。，、；：？！）」』】])[ \t]+/g, '$1')
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  const name = (e as { name?: unknown })?.name
  const message = e instanceof Error ? e.message : String(e)
  // create() without a user gesture: automatic fallback cannot obtain one and retries cannot help; treat as unconfigured and demote for the session.
  if (name === 'NotAllowedError') return new ProviderError('no-key', `Built-in translation needs a user gesture to download the language pack: ${message}`, { cause: e })
  if (name === 'NotSupportedError') return new ProviderError('no-key', `Built-in translation does not support this language pair: ${message}`, { cause: e })
  if (name === 'AbortError') return new ProviderError('aborted', 'Request cancelled', { cause: e })
  return new ProviderError('unknown', message, { cause: e })
}

/**
 * @param target Target ISO 639-3 code from config, converted internally to BCP-47 for the API.
 */
export function createChromeBuiltinProvider(target: string, deps: ChromeBuiltinDeps = {}): TranslationProvider {
  const api = deps.translator === undefined ? globalTranslator() : deps.translator
  const createTimeoutMs = deps.createTimeoutMs ?? SESSION_CREATE_TIMEOUT_MS
  // One gate per provider instance, shared across all calls.
  const withPermit = createSemaphore(BUILTIN_MAX_ITEMS)
  const targetLanguage = toBcp47(target)
  const pair = { sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage }
  /**
   * Cache sessions by language pair (as in KISS builtinAI.js #translatorMap): create() still takes about 8.6s after the model is ready
   * (RESEARCH §6.1); creating per batch turns 10 ms translations into seconds. Cache the Promise, deleting it on failure for real retries.
   */
  const sessions = new Map<string, Promise<TranslatorSession>>()

  /**
   * **Do not use any batch signal**: every batch shares the session, and model loading takes several to tens of seconds.
   * Concurrent batches wait on one Promise. Passing the first batch's signal to create()
   * lets its timeout reject the shared session, returning aborted to every other batch.
   * The fallback chain neither retries nor demotes aborted, so this would halt page translation (Codex #50).
   * Individual translation cancellation still applies through the per-item signal in translate().
   */
  const sessionFor = (): Promise<TranslatorSession> => {
    const key = `${pair.sourceLanguage}_${pair.targetLanguage}`
    const existing = sessions.get(key)
    if (existing) return existing
    let timer: ReturnType<typeof setTimeout> | undefined
    // Provider-owned AbortController: timeout must abort the underlying model load as well as reject the wrapper Promise.
    // Otherwise retries start new loads while the old one keeps running, accumulating in the tab (Codex #50).
    // Independent of every batch request signal.
    const creation = new AbortController()
    const created = new Promise<TranslatorSession>((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new ProviderError('timeout', `Built-in translation session creation exceeded ${createTimeoutMs} ms`)
        creation.abort(error)
        reject(error)
      }, createTimeoutMs)
      api!.create({ ...pair, signal: creation.signal }).then(resolve, reject)
    }).catch((e: unknown) => {
      // Clear the cache on failure, including timeout, so the next attempt actually creates a new session.
      sessions.delete(key)
      throw toProviderError(e)
    }).finally(() => clearTimeout(timer))
    sessions.set(key, created)
    return created
  }

  return {
    id: 'chrome-builtin',
    displayName: 'Chrome built-in translation (offline)',
    kind: 'builtin',
    // Verified to preserve HTML and void/paired placeholders (RESEARCH §6.2), so use markup.
    preservesMarkup: true,
    // Local inference has no network round trip; larger batches reduce scheduling overhead.
    maxBatchChars: 4000,
    maxBatchItems: BUILTIN_MAX_ITEMS,
    // Local execution needs no network rate limit, but keep a gate to prevent hundreds of calls from flooding the main thread.
    rateLimit: { rate: 20, capacity: 20 },
    async isAvailable() {
      if (!api) return false
      try {
        // Only available qualifies: downloadable/downloading require a user gesture for create(),
        // which automatic fallback cannot obtain. Downloads are initiated from the popup (§8.4).
        return (await api.availability(pair)) === 'available'
      } catch {
        return false
      }
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (request.segments.length === 0) return { segments: [], provider: 'chrome-builtin' }
      if (!api) throw new ProviderError('no-key', 'This browser has no built-in translation API')
      const session = await sessionFor()
      try {
        // **Enforce our declared limit**: pipeline plans batches against the preferred engine's limits; fallback passes the same call unchanged.
        // With google-web preferred (8000 characters / 100 items), that could start 100 local inference calls at once,
        // overwhelming the fallback exactly when needed. The gate is provider-wide because the queue can dispatch multiple batches;
        // splitting only within each call does not control the total (Codex #50).
        const texts = await Promise.all(request.segments.map(segment => withPermit(() =>
          session.translate(segment.text, request.signal ? { signal: request.signal } : undefined),
        )))
        return {
          segments: request.segments.map((segment, i) => ({ id: segment.id, text: normalizeSpacing(texts[i]!) })),
          provider: 'chrome-builtin',
        }
      } catch (e) {
        throw toProviderError(e)
      }
    },
  }
}
