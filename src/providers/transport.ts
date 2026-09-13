// The abstraction of where a translation request runs (DESIGN §8.0). One interface, two implementations, so page
// translation and the settings page's connection test share one path and “the test passes, the translation fails”
// (issue #42) cannot recur:
// - createLocalTransport (this file): builds the chain, queues and sends in the background;
// - createMessageTransport (src/shared/transport.ts): turns every method into a message in content / options.
// Two files for bundle size: this one pulls in three providers and the AI SDK, which the content script would parse on every paper opened.
import type { Config } from '@/config/schema'
import { chosenService, serviceOf } from '@/config/services'
import type { RenderPath } from '@/cache/key'
import { buildChain } from '.'
import { createOpenAICompatProvider } from './openai-compat'
import { createFallbackService } from './fallback'
import type { CancelledScopeRegistry } from './request/cancellation'
import { createTranslateService, type CachePort, type TranslateCall, type TranslateMessageResponse, type TranslateService, type TranslateServiceDeps } from './translate-service'
import type { ProviderErrorKind, TranslationProvider } from './types'

/** The engine actually in use right now and the latest hand-over reason (§8.5); the popup explains by it why the translation changed engine */
export interface EngineStatus {
  id: string
  /** The engine that was put aside for this one; `id` lets the popup name it the way it names services (UI.md §2) */
  demoted?: { id: string; kind: ProviderErrorKind; message: string }
}

export interface ProviderStatus {
  /** The engine at the head of the chain — what the chosen service resolved to */
  providerId: string
  /**
   * The service id as saved. Differs from `providerId` when the saved id names nothing (a service deleted from
   * another tab): `getProvider` then substitutes a built-in, and the toggle must not call that runnable when the
   * popup, deciding from the settings, says it is not (`savedFromStatus`, shared/page-action.ts)
   */
  chosen: string
  /** Can it be used */
  available: boolean
  /**
   * With the first choice unavailable, the first usable engine on the fallback chain (§8.5). With it a translation can
   * run — the popup's “translate” button decides by it, or “Google on the chain as fallback, yet the button greyed out” shows up (Codex on #50)
   */
  fallback?: { id: string }
  model?: string
  /** What the content side needs to plan batches and choose the render path (§2 item 3) */
  maxBatchChars: number
  maxBatchItems: number
  /** The negotiated render path (§8.5): one per session; the content side serialises and computes cache keys by it */
  renderPath: RenderPath
  /** The config this chain was built from: the popup waits for these to match what it just saved before restarting a page */
  targetLanguage: string
  promptId: string
  /** `chainRevision` of the configuration this chain was built from; the toggle compares a page's revision with it */
  revision: string
  engine: EngineStatus
  /** The ids of the engines on the chain, by priority. The popup tells by it whether an engine whose pack just downloaded joined the chain; e2e asserts hand-overs by it */
  chain: string[]
  /**
   * Every hand-over still in force, by engine. The page uses it to ask about **the engine its own
   * session started on**: `engine.demoted` is only the most recent one, so an intermediate free
   * engine failing transiently would hide the permanent one that displaced the reader's service
   * (Codex on #157)
   */
  demotions: { id: string; kind: ProviderErrorKind }[]
}

export interface TranslationTransport {
  translate(call: TranslateCall): Promise<TranslateMessageResponse>
  /** Drain the scope's queued and in-flight requests; returns how many. Whether the scope is dead afterwards is the session router's decision (ADR-0005) */
  cancel(scope: string): Promise<number>
  /** `scope` asks about that session's own chain rather than the current global one (§8.5) */
  /**
   * `scope`: the session's own chain. `fresh` (with a scope, over the message transport): a chain built from the
   * configuration as stored now, and the session bound to it — what a session starting on freshly saved settings asks
   * for, so what it records and what serves it are one chain (background/provider-status.ts). The local transport
   * is one chain and ignores the option
   */
  status(scope?: string, options?: { fresh?: boolean }): Promise<ProviderStatus>
  /**
   * Local chains only (absent on the content side). Every scoped request queued or in flight on the chain is
   * drained, whichever session left it here — a session moved on by a language pack leaves its earlier requests
   * behind — and returned as the count; after this, a call still inside the chain (suspended on its cache read,
   * outside every queue, or a connection test's retry) is refused when it wakes and caches nothing. The chain
   * holder retires the chains a deletion replaces: the scope stays live, on the replacement (ADR-0005)
   */
  retire?(): number
  /** Local chains only: whether retire() has been called — the router never binds a session to such a chain */
  isRetired?(): boolean
  /**
   * Local chains only: a call is still inside the chain — suspended on its cache read, at the endpoint, in a
   * retry backoff. The chain holder keeps a superseded chain while this is true, so a deleted service's chain
   * can still be retired (ADR-0005)
   */
  busy?(): boolean
}

export interface LocalTransportDeps extends Pick<TranslateServiceDeps, 'queue' | 'batch' | 'cacheReadBudgetMs'> {
  /** The registry of scopes ended for certain, shared with the session router that writes it (ADR-0005); every service built here reads it */
  cancelled: Pick<CancelledScopeRegistry, 'has'>
  /** The cache port. The background passes the local Dexie; without it nothing is cached (tests) */
  cache?: CachePort
  /** Replace the chain building (for tests) */
  buildChain?: (config: Config) => Promise<{ chain: TranslationProvider[]; renderPath: RenderPath }>
}

/**
 * One chain and one set of queues for the whole browser (the cross-tab quota policy of issue #43). Rate limits are
 * per API key, not per tab: two tabs each with a queue of their own make the real concurrency against one endpoint
 * 2×8, the recipe for 429. Shared, two papers split one concurrency budget — translating both at once halves the
 * throughput, but neither pushes the other into the limit.
 */
export async function createLocalTransport(config: Config, deps: LocalTransportDeps): Promise<TranslationTransport> {
  const revision = await chainRevision(config)
  const { chain, renderPath } = await (deps.buildChain ?? buildChain)(config)
  const primary = chain[0]!
  const chosen = chosenService(config)
  const model = chosen?.model
  /**
   * Set by retire(): this chain has been replaced. A scope moved to the replacement stays live in the registry,
   * so a call of it suspended in one of these services would go on to the deleted provider when it wakes; and a
   * connection test has no scope at all. The services read this gate next to the registry and stop both (#157)
   */
  let retired = false
  const isRetired = () => retired
  const steps = chain.map(engine => ({
    provider: engine,
    service: createTranslateService({
      getProvider: async () => engine,
      // The model name means something for an LLM only; the free engines carry none, so a model change does not invalidate their cache for nothing
      getModel: async () => (engine.id === chosen?.id ? chosen.model : undefined),
      cancelled: deps.cancelled,
      retired: isRetired,
      ...(deps.cache ? { cache: deps.cache } : {}),
      ...(deps.queue ? { queue: deps.queue } : {}),
      ...(deps.batch ? { batch: deps.batch } : {}),
      ...(deps.cacheReadBudgetMs !== undefined ? { cacheReadBudgetMs: deps.cacheReadBudgetMs } : {}),
    }),
  }))
  const service = createFallbackService(steps)

  /**
   * A service of the reader's that this chain is not built around: the connection test has to answer for the
   * endpoint named in the drawer, and editing a service no longer makes it the chosen one, so the
   * one being tested is usually **not** on the chain (Codex on #157). It gets a provider of its own,
   * with no cache behind it — the question is whether the endpoint answers, and a cached sample
   * would report success for one that no longer does
   */
  const offChain = (id: string) => {
    const own = serviceOf(config, id)
    if (!own) return undefined
    const engine = createOpenAICompatProvider(own, { prompts: config.prompts })
    return { provider: engine, service: createTranslateService({ getProvider: async () => engine, getModel: async () => own.model, cancelled: deps.cancelled, retired: isRetired }) }
  }

  /**
   * A call naming an engine **takes no fallback chain**: the settings page's “test connection” asks “does the endpoint
   * I configured work”, and a free fallback on the chain showing as success would be issue #42's “two inconsistent
   * paths” committed the other way round — the reader would think the endpoint fine while the whole page translated through Google
   */
  /** Off-chain services with a call inside: built per named call, they are drained and retired with the chain */
  const offChainLive = new Set<TranslateService>()
  const route = async (call: TranslateCall): Promise<TranslateMessageResponse> => {
    if (call.providerId === undefined) return service.translate(call)
    const step = steps.find(s => s.provider.id === call.providerId)
    if (step) return step.service.translate(call)
    const own = offChain(call.providerId)
    // This one has nothing to do with the segments; split smaller, the engine is still not on the chain
    if (!own) return { ok: false, error: { kind: 'unknown', message: `engine ${call.providerId} is not on the current chain`, isolatable: false } }
    offChainLive.add(own.service)
    try {
      return await own.service.translate(call)
    } finally {
      offChainLive.delete(own.service)
    }
  }
  /** Calls inside this chain right now; `busy()` reports it to the chain holder */
  let inFlight = 0
  const translate = async (call: TranslateCall): Promise<TranslateMessageResponse> => {
    inFlight++
    try {
      return await route(call)
    } finally {
      inFlight--
    }
  }

  const status = async (): Promise<ProviderStatus> => {
    const available = await primary.isAvailable()
    // The first choice unavailable, look for a usable one on the chain: with one the translation runs as usual, on the fallback engine
    let fallback: ProviderStatus['fallback']
    if (!available) {
      for (const engine of chain.slice(1)) {
        if (await engine.isAvailable()) {
          fallback = { id: engine.id }
          break
        }
      }
    }
    const live = service.status()
    const active = chain.find(engine => engine.id === live.activeId) ?? primary
    return {
      providerId: primary.id,
      chosen: config.provider,
      revision,
      available,
      ...(fallback ? { fallback } : {}),
      model,
      maxBatchChars: primary.maxBatchChars,
      maxBatchItems: primary.maxBatchItems,
      renderPath,
      targetLanguage: config.targetLanguage,
      promptId: config.prompts.promptId,
      chain: chain.map(engine => engine.id),
      demotions: live.demotions.map(d => ({ id: d.id, kind: d.kind })),
      engine: {
        id: active.id,
        ...(live.activeId !== live.configuredId && live.demoted
          ? { demoted: { id: live.demoted.id, kind: live.demoted.kind, message: live.demoted.message } }
          : {}),
      },
    }
  }

  return {
    translate,
    cancel: async scope => {
      let cancelled = service.cancel(scope)
      for (const own of offChainLive) cancelled += own.cancel(scope)
      return cancelled
    },
    status,
    retire: () => {
      retired = true
      let cancelled = service.cancelAll()
      for (const own of offChainLive) cancelled += own.cancelAll()
      return cancelled
    },
    isRetired: () => retired,
    busy: () => inFlight > 0,
  }
}

// The chain-config table and the digest live in config/revision.ts: the popup and the toggle compare a page with the
// saved settings through the same digest, and neither may pull this module's providers into its bundle
export { CHAIN_CONFIG_FIELDS, VOLATILE_CONFIG_FIELDS, chainConfigChanged, chainRevision } from '@/config/revision'
import { chainRevision } from '@/config/revision'
