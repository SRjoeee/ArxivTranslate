// The engine fallback chain (DESIGN §8.5). A thin orchestration that touches no queue: createTranslateService is
// already the closure of “one provider, one queue + cache + batching”, and the cache key carries
// providerId | model | promptKey, so different engines' translations are stored apart of themselves — the chain wraps
// the services rather than living inside them.
//
// The problem solved: an expired key, an exhausted quota or a network blip made run.ts stop the whole page (no-key /
// auth trigger scheduler.disconnect()), the reader waiting over half a translation. Hard rule 4: a failure must be recoverable and trigger the fallback chain.
import type { TranslateCall, TranslateMessageResponse, TranslateService } from './translate-service'
import { isPermanentErrorKind, type ProviderErrorKind, type TranslatedSegment, type TranslationProvider } from './types'

export interface FallbackStep {
  provider: TranslationProvider
  service: TranslateService
}

export interface DemotedInfo {
  id: string
  kind: ProviderErrorKind
  message: string
}

export interface FallbackStatus {
  /** The engine chosen in the configuration */
  configuredId: string
  /** The engine in use right now; different from configuredId means a hand-over happened */
  activeId: string
  /** The latest hand-over reason, for the popup to explain why the translation changed engine */
  demoted?: DemotedInfo
  /**
   * **Every** hand-over record still in force. `demoted` alone is not enough: after the LLM is demoted for good on
   * auth, a transient failure of the free engine in between makes `demoted` that transient one, and the caller would
   * think “this change of service is not permanent” (Codex on #157). The content side tells by it whether **the engine its session started on** has been put down for good
   */
  demotions: DemotedInfo[]
}

/**
 * No `reset()`: “the chain returns to the first choice once the reader fixed the configuration” (Codex on #50) is not
 * this layer's job. The chain lives in the background; when a language pack finishes downloading the popup sends
 * `axt:engine-ready` and the background **rebuilds the whole chain** — more thorough than clearing hand-over records: an
 * engine whose `isAvailable()` was false at build time never joined the chain, and no record clearing brings it back (DESIGN §8.5)
 */
export interface FallbackService extends TranslateService {
  status(): FallbackStatus
}

/**
 * The error kinds that trigger a hand-over. `aborted` is not among them — a cancelled session is no fault of the
 * engine's, and starting over on another would only be cancelled again. The queue's own retries (retry-policy) run out
 * before this is reached, so the chain stacks no retry on top.
 */
export const FALLBACK_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  'no-key', 'auth', 'network', 'timeout', 'rate-limit', 'bad-request', 'invalid-response', 'unknown',
])

/**
 * The cool-down of a transient failure. Without one, under a lasting failure every call would wait out that engine's
 * retries and timeouts (up to 120 s) for nothing; too long, a brief blip would leave a worse engine in use for a long
 * while. 60 s is the compromise, injectable for tests
 */
export const DEFAULT_COOLDOWN_MS = 60_000

interface Demotion {
  info: DemotedInfo
  /** undefined = permanent (for this session) */
  until?: number
}

export function createFallbackService(
  steps: readonly FallbackStep[],
  opts: { cooldownMs?: number; now?: () => number } = {},
): FallbackService {
  if (steps.length === 0) throw new Error('a fallback chain needs at least one engine')
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const now = opts.now ?? Date.now
  const demotions = new Map<string, Demotion>()
  let lastDemoted: DemotedInfo | undefined

  const isDemoted = (id: string): boolean => {
    const demotion = demotions.get(id)
    if (!demotion) return false
    if (demotion.until === undefined) return true
    if (now() < demotion.until) return true
    // The cool-down expired: eligible again, and the next call decides whether it succeeds
    demotions.delete(id)
    return false
  }

  const available = (): FallbackStep[] => {
    const alive = steps.filter(step => !isDemoted(step.provider.id))
    // All demoted: back to the last step — better to fail once more and report the error as it is than to have no engine at all
    return alive.length > 0 ? alive : [steps[steps.length - 1]!]
  }

  const demote = (step: FallbackStep, error: { kind: ProviderErrorKind; message: string }): void => {
    const info: DemotedInfo = { id: step.provider.id, kind: error.kind, message: error.message }
    demotions.set(step.provider.id, {
      info,
      // A configuration problem does not heal itself: demoted for good this session, no request wasted on trying (PERMANENT_ERROR_KINDS)
      ...(isPermanentErrorKind(error.kind) ? {} : { until: now() + cooldownMs }),
    })
    lastDemoted = info
    console.warn(`[axt] ${step.provider.id} demoted (${error.kind}): ${error.message}`)
  }

  const translate = async (call: TranslateCall): Promise<TranslateMessageResponse> => {
    const chain = available()
    let last: TranslateMessageResponse | null = null
    // Which segments each step translated (the `partial` of §8.2). Every step on the chain resends the whole call, and
    // the cache key carries the provider, so a segment the previous step translated does not hit the cache at the
    // next — untranslated there, it would be lost. Collected here by id, and the union goes back with a failure: the
    // main engine translating A/B and the fallback C, the caller has to get all three (Codex on #163). A later one overrides an earlier: it is the newer result
    const gathered = new Map<string, TranslatedSegment>()
    const withGathered = (response: TranslateMessageResponse): TranslateMessageResponse => {
      // An aborted answer is the call's refusal — its scope died or its chain was retired — and carries nothing
      // back, not even what an earlier engine on the chain translated (the local review of ADR-0005, sixteenth pass)
      if (response.ok || gathered.size === 0 || response.error.kind === 'aborted') return response
      return { ...response, partial: [...gathered.values()] }
    }
    for (const [index, step] of chain.entries()) {
      const response = await step.service.translate(call)
      if (response.ok) {
        // One success clears that engine's hand-over record: a transient failure must not keep it in the cool-down
        demotions.delete(step.provider.id)
        return response
      }
      for (const segment of response.partial ?? []) gathered.set(segment.id, segment)
      last = response
      const isLast = index === chain.length - 1
      if (isLast || !FALLBACK_KINDS.has(response.error.kind)) return withGathered(response)
      demote(step, response.error)
    }
    // chain is non-empty, so the loop runs at least once
    return withGathered(last!)
  }

  /** Restoring the original withdraws from every queue: one missed, and an in-flight request comes back to write the DOM */
  const cancel = (scope: string): number => steps.reduce((n, step) => n + step.service.cancel(scope), 0)
  const cancelAll = (): number => steps.reduce((n, step) => n + step.service.cancelAll(), 0)

  const status = (): FallbackStatus => ({
    configuredId: steps[0]!.provider.id,
    activeId: available()[0]!.provider.id,
    ...(lastDemoted ? { demoted: lastDemoted } : {}),
    // An expired cool-down record does not count: `isDemoted` draws the same line
    demotions: steps.filter(step => isDemoted(step.provider.id)).map(step => demotions.get(step.provider.id)!.info),
  })

  return { translate, cancel, cancelAll, status }
}
