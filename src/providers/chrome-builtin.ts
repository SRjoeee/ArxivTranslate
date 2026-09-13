// Chrome's built-in translation (DESIGN §8.4; the Phase 0 measurements are in RESEARCH §6). Offline, no key, 10–20 ms
// a sentence — the one link of the fallback chain that needs no network and costs nothing. The isolated world exposes
// `Translator` as well (measured 2026-09-05, RESEARCH §6.3).
//
// Hard rule 4: a free API is unreliable by assumption — its errors are classified on their own, and a failure falls back to the next engine on the chain.
import { toBcp47 } from '@/config/languages'
import { ProviderError, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'
import { WIRE_FORMATS } from './wire-formats'

/** Only the two static methods are used; injected for tests (happy-dom has no such global) */
export interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>
  create(options: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal; monitor?: (m: unknown) => void }): Promise<TranslatorSession>
}

export interface TranslatorSession {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>
}

export interface ChromeBuiltinDeps {
  /** The global `Translator` by default; absent, this browser does not support it */
  translator?: TranslatorApi | null
  /** The session creation's own timeout; injected for tests */
  createTimeoutMs?: number
}

export const BUILTIN_SOURCE_LANGUAGE = 'en'

/** How many inferences at once at most; also the maxBatchItems the provider declares */
export const BUILTIN_MAX_ITEMS = 20

/**
 * The session creation's own timeout. Measured: with the model ready, `create()` still takes about 8.6 s of local
 * loading (RESEARCH §6.1); 60 s leaves ample room. The gate exists because the shared session Promise **takes no
 * batch's signal**: without it a `create()` that never returns would stay in the cache for ever, and every later
 * retry would wait on the same dead Promise (Codex on #50)
 */
export const SESSION_CREATE_TIMEOUT_MS = 60_000

/**
 * A minimal semaphore. The concurrency gate of local inference has to hold **across calls**: the provider declares
 * `maxBatchItems: 20`, and the queue may dispatch several batches at once — 20 each is a hundred concurrent
 * inferences on one local model. Batching inside a call governs that call only, not the whole (Codex on #50)
 */
export function createSemaphore(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []
  const acquire = (): Promise<void> => {
    if (active < limit) {
      active++
      return Promise.resolve()
    }
    // The slot is handed over by release directly; a waiter waking up does not count itself in again: decrement-then-wake
    // leaves a microtask gap in which a newcomer sees a free slot and counts too, and the cap is broken (Codex on #50)
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
 * The extra space after CJK punctuation: the model translates sentence by sentence and joins with spaces, which in
 * Chinese gives “。 我们”. Measured in RESEARCH §6.2. The normalisation is this engine's own business and stays out of the protector — the placeholder protocol cares nothing for layout spaces.
 */
export function normalizeSpacing(text: string): string {
  return text.replace(/([。，、；：？！）」』】])[ \t]+/g, '$1')
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  const name = (e as { name?: unknown })?.name
  const message = e instanceof Error ? e.message : String(e)
  // create() without a user gesture: an automatic hand-over on the chain has no gesture and retrying is useless; treated as “configuration not ready” so the chain demotes it for good
  if (name === 'NotAllowedError') return new ProviderError('no-key', `the built-in translator needs a user gesture to download the language pack: ${message}`, { cause: e })
  if (name === 'NotSupportedError') return new ProviderError('no-key', `the built-in translator does not support this language pair: ${message}`, { cause: e })
  if (name === 'AbortError') return new ProviderError('aborted', 'request cancelled', { cause: e })
  return new ProviderError('unknown', message, { cause: e })
}

/**
 * @param target the target language's ISO 639-3 code (the configuration's shape); converted to BCP-47 for the API inside
 */
export function createChromeBuiltinProvider(target: string, deps: ChromeBuiltinDeps = {}): TranslationProvider {
  const api = deps.translator === undefined ? globalTranslator() : deps.translator
  const createTimeoutMs = deps.createTimeoutMs ?? SESSION_CREATE_TIMEOUT_MS
  // One gate per provider instance, shared by every call
  const withPermit = createSemaphore(BUILTIN_MAX_ITEMS)
  const targetLanguage = toBcp47(target)
  const pair = { sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage }
  /**
   * Sessions cached per language pair (after KISS's builtinAI.js #translatorMap): with the model ready create() still
   * takes about 8.6 s of local loading (RESEARCH §6.1), and a new session per batch would drag a 10 ms translation to
   * seconds. The Promise is cached, not the instance, and removed on failure so a retry can try again
   */
  const sessions = new Map<string, Promise<TranslatorSession>>()

  /**
   * **Takes no batch's signal**: the session is shared by every batch, the model takes seconds to over ten seconds to
   * load, and every concurrent batch waits on the same Promise meanwhile. With the first batch's signal passed to
   * create(), that batch timing out would reject the shared session root and branch, every other batch would get
   * `aborted` — and the fallback chain neither retries nor demotes on `aborted`, so the whole page's translation would
   * stop here (Codex on #50). Cancelling one translation still works, see the signal passed item by item in translate()
   */
  const sessionFor = (): Promise<TranslatorSession> => {
    const key = `${pair.sourceLanguage}_${pair.targetLanguage}`
    const existing = sessions.get(key)
    if (existing) return existing
    let timer: ReturnType<typeof setTimeout> | undefined
    // The provider's own AbortController: a timeout must not only reject the wrapping Promise but really abort the
    // underlying model load, or a retry starts another load while the hung one keeps running, piling up in one tab
    // (Codex on #50). Unrelated to any batch's signal
    const creation = new AbortController()
    const created = new Promise<TranslatorSession>((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new ProviderError('timeout', `the built-in translator session took more than ${createTimeoutMs} ms to create`)
        creation.abort(error)
        reject(error)
      }, createTimeoutMs)
      api!.create({ ...pair, signal: creation.signal }).then(resolve, reject)
    }).catch((e: unknown) => {
      // A failure (a timeout included) clears the cache, so the next retry really creates afresh
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
    // Measured to keep HTML tags and void / paired placeholders (RESEARCH §6.2); the tags path
    // RESEARCH §6.2 measured tags and placeholders kept
    wireFormats: WIRE_FORMATS['chrome-builtin'],
    // Local inference has no network round trip; a larger batch saves scheduling overhead
    maxBatchChars: 4000,
    maxBatchItems: BUILTIN_MAX_ITEMS,
    // No rate limit needed locally, but the gate stays so a flood of hundreds does not fill the main thread
    rateLimit: { rate: 20, capacity: 20 },
    async isAvailable() {
      if (!api) return false
      try {
        // available only: downloadable / downloading both need a user gesture to create(), and an automatic hand-over on
        // the chain has none. The download entry is the popup (§8.4)
        return (await api.availability(pair)) === 'available'
      } catch {
        return false
      }
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (request.segments.length === 0) return { segments: [], provider: 'chrome-builtin' }
      if (!api) throw new ProviderError('no-key', 'this browser has no built-in translation API')
      const session = await sessionFor()
      try {
        // **Hold to the cap declared**: batches are planned by the pipeline for the **first-choice** engine's caps, and
        // the fallback chain forwards the same call as it is — with google-web first (8000 characters / 100 items),
        // this would fire 100 concurrent inferences at the local model in one go, crushing it exactly when it is needed
        // as the fallback. The gate is provider-level: the queue may dispatch several batches at once, and batching inside one call governs nothing (Codex on #50)
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
