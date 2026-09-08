// Provider 统一接口（DESIGN §8）。每个引擎一个文件，禁止跨文件共享未公开接口的细节。

import type { WireFormat } from '@/core/protector/tokens'
import { attachRequestErrorMeta, type RequestErrorMeta } from './request/retry-policy'

export interface TranslateSegment {
  id: string
  text: string
}

export interface TranslateContext {
  paperTitle?: string
  /** 论文摘要（截断），每批都带：论文自带摘要，不必像 Read Frog 那样再调一次 LLM 生成 */
  abstract?: string
  sectionTitle?: string
  glossary?: { term: string; translation: string }[]
}

export interface TranslateRequest {
  segments: TranslateSegment[]
  /** v1 固定 */
  source: 'en'
  /** BCP-47，如 zh-CN */
  target: string
  context?: TranslateContext
  /** 不跨消息边界；由调用方在 background 内附加 */
  signal?: AbortSignal
}

export interface TranslateResult {
  segments: TranslateSegment[]
  provider: string
  model?: string
}

export type ProviderKind = 'llm' | 'mt' | 'builtin'

export interface TranslationProvider {
  id: string
  displayName: string
  kind: ProviderKind
  /**
   * 这个引擎能保住的线上格式，**按偏好排序**，取交集与链上其他引擎协商（§8.5）。
   * 空数组 = 一个占位符都保不住，只能走 runs。
   * 不是布尔位：Google 两种格式都保得住，用布尔位表达不了，会逼得选了微软就没有兜底
   */
  wireFormats: readonly WireFormat[]
  /** 单次请求字符上限 */
  maxBatchChars: number
  /** 单次请求段落数上限 */
  maxBatchItems: number
  /** 请求速率（令牌桶：每秒 rate 个、最多攒 capacity 个）；不声明则用服务默认的 8 / 20，即 Read Frog 的默认值（§8.2） */
  rateLimit?: { rate: number; capacity: number }
  /**
   * 同时在飞的请求数上限；不声明则用服务默认的 8。与 rateLimit 是两种闸：令牌桶管「每秒发几个」，
   * 这个管「同时挂着几个」。响应快的端点靠它就够，用速率去限反而会让快响应白等令牌（§8.3）
   */
  maxConcurrent?: number
  /** 健康检查：key 是否配置、端点是否可达、内置模型是否可用 */
  isAvailable(): Promise<boolean>
  translate(request: TranslateRequest): Promise<TranslateResult>
  /** 提示词指纹，进缓存键（只有 LLM provider 有）：换了提示词不能再命中旧译文 */
  promptKey?: string
  /**
   * 缓存身份，进缓存键；不声明就用 id。
   * 同一个 id 下**输出会变的非秘密配置**要写进来：openai-compat 的 id 对所有 OpenAI 兼容端点都一样，
   * 只用 id + 模型名的话，OpenRouter 上的同名模型与本机 Ollama 上的共用缓存条目、译文互相污染
   *（issue #45 的实验 3）。**绝不能放 API key**（硬规则 7）
   */
  cacheId?: string
}

export type ProviderErrorKind = 'no-key' | 'network' | 'rate-limit' | 'auth' | 'bad-request' | 'invalid-response' | 'timeout' | 'aborted' | 'unknown'

/**
 * 每种 kind 对应的重试元数据，构造时就挂上：移植的 retry-policy 只认它自己的 kind，
 * 认不出 no-key / aborted 就会当未知错误重试（实测 no-key 被调 4 次、白等 7s）。
 * 在构造函数里挂而不是在 provider 的 catch 里挂，是因为 no-key、id 对不上这些错误在 try 之外直接 throw。
 * provider 随后按状态码补的元数据（Retry-After、SDK 的 isRetryable）叠在这份之上
 */
const META_BY_KIND: Record<ProviderErrorKind, RequestErrorMeta> = {
  'no-key': { kind: 'access-denied', isRetryable: false }, // 与 401 / 403 同：不重试，整条队列排空
  'auth': { kind: 'access-denied', isRetryable: false },
  'aborted': { isRetryable: false },
  'invalid-response': { isRetryable: false },
  // 请求本身不对（4xx，非 401/403/429）：重试多少次都一样，交给降级链换个引擎（Codex 在 #17 指出）
  'bad-request': { kind: 'bad-request', isRetryable: false },
  'rate-limit': { kind: 'rate-limit' },
  'timeout': { kind: 'timeout', isRetryable: true },
  'network': { kind: 'network', isRetryable: true },
  'unknown': {},
}

export class ProviderError extends Error {
  /**
   * 这次失败**换更小的批次重试有没有可能成功**（Codex 在 #61 指出）。默认认为有：
   * LLM 的 `invalid-response` 多半是某一段把输出带偏了，拆小能定位到它，所以 BatchQueue 会
   * 重试 3 次再逐条兜底。但服务端整个返回坏了（不是 JSON、格式不对）属于**系统性**失败，
   * 拆多小都一样——100 段的一批会白打 104 次请求，而且打在我们本就想省着用的免费端点上。
   * provider 遇到这种情况显式声明 false，`asBatchError` 就不把它转成批次错误
   */
  readonly isolatable: boolean

  constructor(readonly kind: ProviderErrorKind, message: string, options?: { cause?: unknown; isolatable?: boolean }) {
    super(message, options)
    this.name = 'ProviderError'
    this.isolatable = options?.isolatable ?? true
    attachRequestErrorMeta(this, META_BY_KIND[kind])
  }
}
