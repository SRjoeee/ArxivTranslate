// Engine fallback chain (DESIGN §8.5): thin orchestration around existing queues.
// createTranslateService already closes over one provider, queues, cache and batching; cache keys include
// providerId | model | promptKey, naturally separating translations. Wrap the service instead of embedding the chain inside it.
//
// Expired keys, exhausted quotas and network failures previously stopped all page translation in run.ts (no-key/auth call
// scheduler.disconnect()), leaving readers waiting on a half-translated paper. Hard rule 4 requires recoverable failure through fallback.
import type { TranslateCall, TranslateMessageResponse, TranslateService } from './translate-service'
import type { ProviderErrorKind, TranslationProvider } from './types'

export interface FallbackStep {
  provider: TranslationProvider
  service: TranslateService
}

export interface DemotedInfo {
  id: string
  displayName: string
  kind: ProviderErrorKind
  message: string
}

export interface FallbackStatus {
  /** Configured engine. */
  configuredId: string
  /** Currently active engine; a different id from configuredId indicates fallback. */
  activeId: string
  /** Latest fallback reason, shown in the popup to explain engine changes. */
  demoted?: DemotedInfo
}

/**
 * No reset(): returning to the preferred engine after configuration is fixed (Codex #50) belongs above this layer.
 * The chain lives in background. After a language pack download, popup sends axt:engine-ready and background **rebuilds the entire chain**.
 * Clearing demotion records cannot restore an engine excluded during construction because isAvailable() was false (DESIGN §8.5).
 */
export interface FallbackService extends TranslateService {
  status(): FallbackStatus
}

/**
 * Errors that trigger fallback. aborted is excluded: session cancellation is not an engine failure, and another engine would just be cancelled again.
 * The queue's retry-policy has already exhausted retries before reaching this layer; do not add another retry layer.
 */
export const FALLBACK_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  'no-key', 'auth', 'network', 'timeout', 'rate-limit', 'bad-request', 'invalid-response', 'unknown',
])

/** Configuration errors cannot self-recover: demote for the session rather than waste another request. */
const PERMANENT_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>(['no-key', 'auth'])

/**
 * Transient failure cooldown. Without it, persistent faults repeat the engine's full retries/timeouts (up to 120s) on every call.
 * Too long a cooldown leaves a weaker engine active after a brief fault. 60s is a compromise, injectable for tests.
 */
export const DEFAULT_COOLDOWN_MS = 60_000

interface Demotion {
  info: DemotedInfo
  /** undefined = permanent for this session. */
  until?: number
}

export function createFallbackService(
  steps: readonly FallbackStep[],
  opts: { cooldownMs?: number; now?: () => number } = {},
): FallbackService {
  if (steps.length === 0) throw new Error('Fallback chain requires at least one engine')
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const now = opts.now ?? Date.now
  const demotions = new Map<string, Demotion>()
  let lastDemoted: DemotedInfo | undefined

  const isDemoted = (id: string): boolean => {
    const demotion = demotions.get(id)
    if (!demotion) return false
    if (demotion.until === undefined) return true
    if (now() < demotion.until) return true
    // Cooldown expired: make the engine eligible; the next call determines whether it succeeds.
    demotions.delete(id)
    return false
  }

  const available = (): FallbackStep[] => {
    const alive = steps.filter(step => !isDemoted(step.provider.id))
    // If all engines are demoted, use the last step: report its real failure rather than have no engine to call.
    return alive.length > 0 ? alive : [steps[steps.length - 1]!]
  }

  const demote = (step: FallbackStep, error: { kind: ProviderErrorKind; message: string }): void => {
    const info: DemotedInfo = { id: step.provider.id, displayName: step.provider.displayName, kind: error.kind, message: error.message }
    demotions.set(step.provider.id, {
      info,
      ...(PERMANENT_KINDS.has(error.kind) ? {} : { until: now() + cooldownMs }),
    })
    lastDemoted = info
    console.warn(`[axt] ${step.provider.displayName} demoted (${error.kind}): ${error.message}`)
  }

  const translate = async (call: TranslateCall): Promise<TranslateMessageResponse> => {
    const chain = available()
    let last: TranslateMessageResponse | null = null
    for (const [index, step] of chain.entries()) {
      const response = await step.service.translate(call)
      if (response.ok) {
        // One success clears this engine's demotion; a transient fault should not keep it cooling down afterward.
        demotions.delete(step.provider.id)
        return response
      }
      last = response
      const isLast = index === chain.length - 1
      if (isLast || !FALLBACK_KINDS.has(response.error.kind)) return response
      demote(step, response.error)
    }
    // The chain is nonempty, so the loop runs at least once.
    return last!
  }

  /** Restore must cancel every queue; missing one permits an in-flight result to write to the DOM. */
  const cancel = (scope: string): number => steps.reduce((n, step) => n + step.service.cancel(scope), 0)

  const status = (): FallbackStatus => ({
    configuredId: steps[0]!.provider.id,
    activeId: available()[0]!.provider.id,
    ...(lastDemoted ? { demoted: lastDemoted } : {}),
  })

  return { translate, cancel, status }
}
