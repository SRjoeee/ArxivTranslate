// 翻译请求的执行位置抽象（DESIGN §8.0）。同一个接口两种实现，页面翻译与设置页的连接测试共用一条路径，
// 不可能再出现「测试通过、翻译失败」（issue #42）：
// - createLocalTransport（本文件）：在 background 里建链、排队、发请求；
// - createMessageTransport（src/shared/transport.ts）：在 content / options 里把每个方法变成一条消息。
// 两个实现分文件是为了包体积：本文件会拉进三个 provider 与 AI SDK，content script 每打开一篇论文都要解析它。
import type { Config } from '@/config/schema'
import { buildChain } from '.'
import { createFallbackService } from './fallback'
import { createTranslateService, type CachePort, type TranslateCall, type TranslateMessageResponse, type TranslateServiceDeps } from './translate-service'
import type { ProviderErrorKind, TranslationProvider } from './types'

/** 此刻实际在用的引擎与最近一次降级原因（§8.5）；popup 据此解释译文为什么换了引擎 */
export interface EngineStatus {
  id: string
  displayName: string
  demoted?: { displayName: string; kind: ProviderErrorKind; message: string }
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
  preservesMarkup: boolean
  engine: EngineStatus
  /** 链上引擎的 id，按优先级。popup 用它判断刚下好语言包的引擎有没有进链，e2e 用它断言降级 */
  chain: string[]
}

export interface TranslationTransport {
  translate(call: TranslateCall): Promise<TranslateMessageResponse>
  /** 撤掉该 scope 排队与在飞的请求，返回撤掉的条数 */
  cancel(scope: string): Promise<number>
  status(): Promise<ProviderStatus>
}

export interface LocalTransportDeps extends Pick<TranslateServiceDeps, 'queue' | 'batch' | 'cacheReadBudgetMs'> {
  /** 缓存端口。background 传本地 Dexie；不传就不缓存（测试） */
  cache?: CachePort
  /** 换掉建链（测试用） */
  buildChain?: (config: Config) => Promise<TranslationProvider[]>
}

/**
 * 全浏览器共用一条链、一套队列（issue #43 的跨标签页额度策略）。限流是按 API key 算的，不是按标签页：
 * 两个标签页各起一套队列，对同一端点的实际并发就是 2×8，正是招 429 的配方。共享之后两篇论文
 * 分享同一份并发预算，同时翻两篇的吞吐减半，但不会互相把对方打进限流。
 */
export async function createLocalTransport(config: Config, deps: LocalTransportDeps = {}): Promise<TranslationTransport> {
  const chain = await (deps.buildChain ?? buildChain)(config)
  const primary = chain[0]!
  const model = config.provider === 'openai-compat' ? config.openaiCompat.model : undefined
  const service = createFallbackService(chain.map(engine => ({
    provider: engine,
    service: createTranslateService({
      getProvider: async () => engine,
      // 模型名只对 LLM 有意义；免费引擎不带，免得换模型时白白让它的缓存失效
      getModel: async () => (engine.id === 'openai-compat' ? config.openaiCompat.model : undefined),
      ...(deps.cache ? { cache: deps.cache } : {}),
      ...(deps.queue ? { queue: deps.queue } : {}),
      ...(deps.batch ? { batch: deps.batch } : {}),
      ...(deps.cacheReadBudgetMs !== undefined ? { cacheReadBudgetMs: deps.cacheReadBudgetMs } : {}),
    }),
  })))

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
    translate: call => service.translate(call),
    cancel: async scope => service.cancel(scope),
    status,
  }
}

/**
 * 建链要读的配置字段。其余字段（模式、样式、预加载、术语表）改了**不能**重建：
 * content 每切一次显示模式就写一次配置，而那时页面往往正在翻，重建会把令牌桶和降级记录一起清掉。
 * `tests/providers/transport.test.ts` 守着这张表：新增配置字段必须显式归类。
 */
export const CHAIN_CONFIG_FIELDS = ['provider', 'openaiCompat', 'prompts', 'targetLanguage', 'fallback'] as const
/** 与 CHAIN_CONFIG_FIELDS 互补，两者之和必须覆盖 Config 的全部字段 */
export const VOLATILE_CONFIG_FIELDS = ['version', 'mode', 'glossary', 'style', 'preload'] as const

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
