// 翻译请求的执行位置抽象（DESIGN §8.0）。同一个接口两种实现，页面翻译与设置页的连接测试共用一条路径，
// 不可能再出现「测试通过、翻译失败」（issue #42）：
// - createLocalTransport（本文件）：在 background 里建链、排队、发请求；
// - createMessageTransport（src/shared/transport.ts）：在 content / options 里把每个方法变成一条消息。
// 两个实现分文件是为了包体积：本文件会拉进三个 provider 与 AI SDK，content script 每打开一篇论文都要解析它。
import type { Config } from '@/config/schema'
import { chosenService, serviceOf } from '@/config/services'
import type { RenderPath } from '@/cache/key'
import { buildChain } from '.'
import { createOpenAICompatProvider } from './openai-compat'
import { createFallbackService } from './fallback'
import type { CancelledScopeRegistry } from './request/cancellation'
import { createTranslateService, type CachePort, type TranslateCall, type TranslateMessageResponse, type TranslateServiceDeps } from './translate-service'
import type { ProviderErrorKind, TranslationProvider } from './types'

/** 此刻实际在用的引擎与最近一次降级原因（§8.5）；popup 据此解释译文为什么换了引擎 */
export interface EngineStatus {
  id: string
  displayName: string
  /** The engine that was put aside for this one; `id` lets the popup name it the way it names services (UI.md §2) */
  demoted?: { id: string; displayName: string; kind: ProviderErrorKind; message: string }
}

export interface ProviderStatus {
  /** 配置里选的那个引擎 */
  providerId: string
  /** 它能不能用 */
  available: boolean
  /**
   * 首选不可用时，降级链上第一个能用的引擎（§8.5）。有它就能翻——
   * popup 的「翻译」按钮据此判断，否则会出现「链上有 Google 兜底、按钮却是灰的」（Codex 在 #50 指出）
   */
  fallback?: { id: string; displayName: string }
  model?: string
  /** content 侧规划批次与选择渲染路径要用（§2 第 3 条） */
  maxBatchChars: number
  maxBatchItems: number
  /** 协商出的渲染路径（§8.5）：一次会话只有一个，content 侧据此序列化与算缓存键 */
  renderPath: RenderPath
  /** The config this chain was built from: the popup waits for these to match what it just saved before restarting a page */
  targetLanguage: string
  promptId: string
  /**
   * Which build of the chain this is. A page records it at session start, so the popup can say
   * "this page is on an older chain" for **any** change — a new key, model, endpoint or prompt keeps
   * the service id and the target, and comparing those alone missed all of them (Codex on #157)
   */
  revision: number
  engine: EngineStatus
  /** 链上引擎的 id，按优先级。popup 用它判断刚下好语言包的引擎有没有进链，e2e 用它断言降级 */
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
  status(scope?: string): Promise<ProviderStatus>
  /**
   * Local chains only (absent on the content side). After this, a call still inside the chain — suspended on its
   * cache read, outside every queue — is refused when it wakes and caches nothing. The router retires a chain it
   * replaces because a service on it is gone: the scope stays live, on the replacement (ADR-0005)
   */
  retire?(): void
}

export interface LocalTransportDeps extends Pick<TranslateServiceDeps, 'queue' | 'batch' | 'cacheReadBudgetMs'> {
  /** The registry of scopes ended for certain, shared with the session router that writes it (ADR-0005); every service built here reads it */
  cancelled: Pick<CancelledScopeRegistry, 'has'>
  /** 缓存端口。background 传本地 Dexie；不传就不缓存（测试） */
  cache?: CachePort
  /** 换掉建链（测试用） */
  buildChain?: (config: Config) => Promise<{ chain: TranslationProvider[]; renderPath: RenderPath }>
}

/**
 * 全浏览器共用一条链、一套队列（issue #43 的跨标签页额度策略）。限流是按 API key 算的，不是按标签页：
 * 两个标签页各起一套队列，对同一端点的实际并发就是 2×8，正是招 429 的配方。共享之后两篇论文
 * 分享同一份并发预算，同时翻两篇的吞吐减半，但不会互相把对方打进限流。
 */
/** Bumped by every build, so a session can tell whether the chain moved on without it */
let revision = 0

export async function createLocalTransport(config: Config, deps: LocalTransportDeps): Promise<TranslationTransport> {
  const built = ++revision
  const { chain, renderPath } = await (deps.buildChain ?? buildChain)(config)
  const primary = chain[0]!
  const chosen = chosenService(config)
  const model = chosen?.model
  /**
   * Set by retire(): this chain has been replaced. A scope moved to the replacement stays live in the registry,
   * so a call of it suspended in one of these services would go on to the deleted provider when it wakes;
   * the services read this gate together with the registry and stop it there (#157)
   */
  let retired = false
  const refuse: Pick<CancelledScopeRegistry, 'has'> = { has: scope => retired || deps.cancelled.has(scope) }
  const steps = chain.map(engine => ({
    provider: engine,
    service: createTranslateService({
      getProvider: async () => engine,
      // 模型名只对 LLM 有意义；免费引擎不带，免得换模型时白白让它的缓存失效
      getModel: async () => (engine.id === chosen?.id ? chosen.model : undefined),
      cancelled: refuse,
      ...(deps.cache ? { cache: deps.cache } : {}),
      ...(deps.queue ? { queue: deps.queue } : {}),
      ...(deps.batch ? { batch: deps.batch } : {}),
      ...(deps.cacheReadBudgetMs !== undefined ? { cacheReadBudgetMs: deps.cacheReadBudgetMs } : {}),
    }),
  }))
  const service = createFallbackService(steps)

  /**
   * A service of the reader's that this chain is not built around: 连接 has to answer for the
   * endpoint named in the drawer, and editing a service no longer makes it the chosen one, so the
   * one being tested is usually **not** on the chain (Codex on #157). It gets a provider of its own,
   * with no cache behind it — the question is whether the endpoint answers, and a cached sample
   * would report success for one that no longer does
   */
  const offChain = (id: string) => {
    const own = serviceOf(config, id)
    if (!own) return undefined
    const engine = createOpenAICompatProvider(own, { prompts: config.prompts })
    return { provider: engine, service: createTranslateService({ getProvider: async () => engine, getModel: async () => own.model, cancelled: refuse }) }
  }

  /**
   * 指名引擎的调用**不走降级链**：设置页的「测试连接」问的是「我配的这个端点通不通」，
   * 链上有免费兜底就把它显示成成功，等于把 issue #42 抱怨的「两条路径不一致」换个方向再犯一次——
   * 用户会以为端点没问题，实际整页都在用 Google 翻
   */
  const translate = (call: TranslateCall): Promise<TranslateMessageResponse> => {
    if (call.providerId === undefined) return service.translate(call)
    const step = steps.find(s => s.provider.id === call.providerId) ?? offChain(call.providerId)
    // 这一条与段落无关，拆小了也还是同一个引擎不在链上
    if (!step) return Promise.resolve({ ok: false, error: { kind: 'unknown', message: `引擎 ${call.providerId} 不在当前链上`, isolatable: false } })
    return step.service.translate(call)
  }

  const status = async (): Promise<ProviderStatus> => {
    const available = await primary.isAvailable()
    // 首选不可用时看看链上还有没有能用的：有就照样能翻，只是走降级引擎
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
      renderPath,
      targetLanguage: config.targetLanguage,
      promptId: config.prompts.promptId,
      revision: built,
      chain: chain.map(engine => engine.id),
      demotions: live.demotions.map(d => ({ id: d.id, kind: d.kind })),
      engine: {
        id: active.id,
        displayName: active.displayName,
        ...(live.activeId !== live.configuredId && live.demoted
          ? { demoted: { id: live.demoted.id, displayName: live.demoted.displayName, kind: live.demoted.kind, message: live.demoted.message } }
          : {}),
      },
    }
  }

  return {
    translate,
    cancel: async scope => service.cancel(scope),
    status,
    retire: () => {
      retired = true
    },
  }
}

/**
 * 建链要读的配置字段。其余字段（模式、样式、预加载、术语表）改了**不能**重建：
 * content 每切一次显示模式就写一次配置，而那时页面往往正在翻，重建会把令牌桶和降级记录一起清掉。
 * `tests/providers/transport.test.ts` 守着这张表：新增配置字段必须显式归类。
 */
export const CHAIN_CONFIG_FIELDS = ['provider', 'services', 'prompts', 'targetLanguage', 'fallback'] as const
/** 与 CHAIN_CONFIG_FIELDS 互补，两者之和必须覆盖 Config 的全部字段 */
export const VOLATILE_CONFIG_FIELDS = ['version', 'mode', 'glossary', 'appearance', 'preload', 'image', 'reading', 'uiLanguage'] as const

export function chainConfigChanged(a: Config, b: Config): boolean {
  return CHAIN_CONFIG_FIELDS.some(field => !deepEqual(a[field], b[field]))
}

/** 逐字段比较而不是序列化：配置里有 API key，不给它多留一份副本（硬规则 7） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}
