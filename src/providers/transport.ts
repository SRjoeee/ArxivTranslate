// Translation execution abstraction (DESIGN §8.0). Two implementations of one interface let page translation and settings connection tests share a path,
// preventing the "connection test passes but translation fails" mismatch (issue #42):
// - createLocalTransport (this file) builds the chain, queues work and sends requests in background.
// - createMessageTransport (src/shared/transport.ts) maps each method to a message in content/options.
// Separate files keep all three providers and AI SDK out of the content bundle parsed for every paper.
import type { Config } from '@/config/schema'
import { buildChain } from '.'
import { createFallbackService } from './fallback'
import { createTranslateService, type CachePort, type TranslateCall, type TranslateMessageResponse, type TranslateServiceDeps } from './translate-service'
import type { ProviderErrorKind, TranslationProvider } from './types'

/** Active engine and latest fallback reason (§8.5); lets the popup explain engine changes. */
export interface EngineStatus {
  id: string
  displayName: string
  demoted?: { displayName: string; kind: ProviderErrorKind; message: string }
}

export interface ProviderStatus {
  /** Engine selected in configuration. */
  providerId: string
  /** Whether that engine is available. */
  available: boolean
  /**
   * First available fallback when the preferred engine is unavailable (§8.5). Translation can proceed if this exists.
   * The popup uses it to enable Translate, avoiding a disabled button despite a working Google fallback (Codex #50).
   */
  fallback?: { id: string; displayName: string }
  model?: string
  /** Used by content to plan batches and select a rendering path (§2, rule 3). */
  maxBatchChars: number
  maxBatchItems: number
  preservesMarkup: boolean
  engine: EngineStatus
  /** Engine ids in priority order; popup checks whether a downloaded engine joined the chain, and e2e asserts fallback behavior. */
  chain: string[]
}

export interface TranslationTransport {
  translate(call: TranslateCall): Promise<TranslateMessageResponse>
  /** Cancel queued and in-flight requests for this scope; return the number cancelled. */
  cancel(scope: string): Promise<number>
  status(): Promise<ProviderStatus>
}

export interface LocalTransportDeps extends Pick<TranslateServiceDeps, 'queue' | 'batch' | 'cacheReadBudgetMs'> {
  /** Cache port: background uses local Dexie; omit to disable caching in tests. */
  cache?: CachePort
  /** Override chain construction for tests. */
  buildChain?: (config: Config) => Promise<TranslationProvider[]>
}

/**
 * One chain and queue set for the entire browser (cross-tab quota policy, issue #43). Rate limits apply per API key, not per tab.
 * Separate queues for two tabs would produce 2×8 concurrent requests against one endpoint and invite 429s. Sharing the budget
 * halves per-paper throughput when two papers translate together but prevents them from rate-limiting each other.
 */
export async function createLocalTransport(config: Config, deps: LocalTransportDeps = {}): Promise<TranslationTransport> {
  const chain = await (deps.buildChain ?? buildChain)(config)
  const primary = chain[0]!
  const model = config.provider === 'openai-compat' ? config.openaiCompat.model : undefined
  const steps = chain.map(engine => ({
    provider: engine,
    service: createTranslateService({
      getProvider: async () => engine,
      // Model names matter only for LLMs; omit them for free engines so model changes do not invalidate unrelated caches.
      getModel: async () => (engine.id === 'openai-compat' ? config.openaiCompat.model : undefined),
      ...(deps.cache ? { cache: deps.cache } : {}),
      ...(deps.queue ? { queue: deps.queue } : {}),
      ...(deps.batch ? { batch: deps.batch } : {}),
      ...(deps.cacheReadBudgetMs !== undefined ? { cacheReadBudgetMs: deps.cacheReadBudgetMs } : {}),
    }),
  }))
  const service = createFallbackService(steps)

  /**
   * Explicit provider calls **bypass fallback**: Test connection asks whether the configured endpoint works.
   * Reporting success from a free fallback would repeat issue #42's path mismatch in reverse:
   * the user would think the endpoint works while Google actually translates the entire page.
   */
  const translate = (call: TranslateCall): Promise<TranslateMessageResponse> => {
    if (call.providerId === undefined) return service.translate(call)
    const step = steps.find(s => s.provider.id === call.providerId)
    if (!step) return Promise.resolve({ ok: false, error: { kind: 'unknown', message: `Engine ${call.providerId} is not in the current chain` } })
    return step.service.translate(call)
  }

  const status = async (): Promise<ProviderStatus> => {
    const available = await primary.isAvailable()
    // If the preferred engine is unavailable, a working fallback still allows translation.
    let fallback: ProviderStatus['fallback']
    if (!available) {
      for (const engine of chain.slice(1)) {
        if (await engine.isAvailable()) {
          fallback = { id: engine.id, displayName: engine.displayName }
          break
        }
      }
    }
    const live = service.status()
    const active = chain.find(engine => engine.id === live.activeId) ?? primary
    return {
      providerId: primary.id,
      available,
      ...(fallback ? { fallback } : {}),
      model,
      maxBatchChars: primary.maxBatchChars,
      maxBatchItems: primary.maxBatchItems,
      preservesMarkup: primary.preservesMarkup,
      chain: chain.map(engine => engine.id),
      engine: {
        id: active.id,
        displayName: active.displayName,
        ...(live.activeId !== live.configuredId && live.demoted
          ? { demoted: { displayName: live.demoted.displayName, kind: live.demoted.kind, message: live.demoted.message } }
          : {}),
      },
    }
  }

  return {
    translate,
    cancel: async scope => service.cancel(scope),
    status,
  }
}

/**
 * Configuration fields used to build the chain. Changes to mode, style, preload or glossary **must not** rebuild it:
 * content writes config whenever the display mode changes, often during translation; rebuilding would reset token buckets and fallback history.
 * tests/providers/transport.test.ts guards this list: every new config field must be explicitly classified.
 */
export const CHAIN_CONFIG_FIELDS = ['provider', 'openaiCompat', 'prompts', 'targetLanguage', 'fallback'] as const
/** Complement of CHAIN_CONFIG_FIELDS; together they must cover every Config field. */
export const VOLATILE_CONFIG_FIELDS = ['version', 'mode', 'glossary', 'style', 'preload', 'image'] as const

export function chainConfigChanged(a: Config, b: Config): boolean {
  return CHAIN_CONFIG_FIELDS.some(field => !deepEqual(a[field], b[field]))
}

/** Compare fields directly instead of serializing to avoid another copy of API keys (hard rule 7). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}
