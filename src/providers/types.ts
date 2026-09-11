// Provider 统一接口（DESIGN §8）。每个引擎一个文件，禁止跨文件共享未公开接口的细节。

import type { WireFormat } from '@/core/protector/tokens'
import type { SentenceAlignment } from './alignment'
import { attachRequestErrorMeta, type RequestErrorMeta } from './request/retry-policy'

export interface TranslateSegment {
  id: string
  text: string
  /**
   * 句子边界在 `text` 里的位置（§8.6）。**由调用方给，服务层不自己切**：选切点要看块本身——
   * `sentenceCuts` 需要一个从占位符槽位建出来的 `SplitContext` 才分得清注解与公式，
   * 而它实测的精度明确不含参考文献块、调用方不得在那里运行它。这些从线上文本看不出来。
   *
   * 不带就不插标记。引擎自己汇报句边界时（微软）也不插
   */
  cuts?: number[]
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

/**
 * A translated segment. `alignment` is present only when the engine could report sentence
 * boundaries **and** they reconstructed both texts (see `alignment.ts`). There is no capability
 * flag on the provider: an engine that can report it does, and the pipeline never branches on which
 * mechanism produced it — that is the one architectural requirement issue #105 puts on this layer.
 */
export interface TranslatedSegment extends TranslateSegment {
  alignment?: SentenceAlignment
}

export interface TranslateResult {
  segments: TranslatedSegment[]
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
  /**
   * 自己汇报句边界（§8.6）。声明了的引擎，服务层就不给它插句子标记——微软的 `sentLen` 是原生的，
   * 插标记只会白改请求。没声明的（Google、LLM）由服务层在 `tags` 格式下插 `<x id="N"/>` 边界标记，
   * 回来再摘掉（`sentence-markers.ts`）
   */
  reportsSentences?: boolean
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

/**
 * 每种 kind 默认**拆小了重试有没有可能成功**。provider 知道得更多时用构造参数覆盖。
 *
 * 判据只有一条：这次失败是**某一段引起的**，还是整条路都不通？
 * - `invalid-response`：多半是某一段把模型的输出带偏了，拆小能定位到它（服务端整个返回坏了的那种，
 *   provider 自己声明 false）
 * - `timeout`：批越小越可能在预算内回来
 * - `unknown`：没有依据，保持从前的行为（拆）
 * - `rate-limit` / `network` / `bad-request`：拆小只会把同一个失败**乘以段数**——限额上更是反效果，
 *   一批变成七次请求。`bad-request` 的元数据早就写着"重试多少次都一样，交给降级链换个引擎"，
 *   拆分同理
 * - `no-key` / `auth`：整条队列排空，根本走不到拆分
 * - `aborted`：已经不要这个结果了
 */
const ISOLATABLE_BY_KIND: Record<ProviderErrorKind, boolean> = {
  'invalid-response': true,
  'unknown': true,
  // `timeout` 曾经也算可隔离（"批小了也许就在预算内回来了"），量完之后改掉：8 段的一批在内容层
  // 扇出 **15 次调用**（`8,4,2,1,1,2,1,1,4,2,1,1,2,1,1`），而队列本身还会按 retry-policy 再重试，
  // 两层相乘最多 45 次请求、每次各等自己的超时——正是"整页停在进行中"那个我们设超时要避免的场景。
  // 超时的恢复归队列：它按字数给预算、按 meta 记整批的期限，数据和责任都在那一层（tests/pipeline 有回归）
  'timeout': false,
  'rate-limit': false,
  'network': false,
  'bad-request': false,
  'no-key': false,
  'auth': false,
  'aborted': false,
}

export class ProviderError extends Error {
  /**
   * 这次失败**换更小的批次重试有没有可能成功**（Codex 在 #61 指出）。按 kind 取默认值，
   * provider 可以覆盖：服务端整个返回坏了（不是 JSON、格式不对）属于**系统性**失败，
   * 拆多小都一样——100 段的一批会白打 104 次请求，而且打在我们本就想省着用的免费端点上。
   *
   * 两处在用：`asBatchError` 决定要不要转成批次错误（BatchQueue 会重试 3 次再逐条兜底）；
   * 这个标记跟着 `toErrorInfo` 过消息边界之后，content 侧的 `translateSegments` 据此决定
   * 要不要对半拆分——不带它的时候，4 段的系统性 `bad-request` 会拆成 7 次调用
   *（研究审计 B20 实测 `4,2,1,1,2,1,1`）
   */
  readonly isolatable: boolean

  constructor(readonly kind: ProviderErrorKind, message: string, options?: { cause?: unknown; isolatable?: boolean }) {
    super(message, options)
    this.name = 'ProviderError'
    this.isolatable = options?.isolatable ?? ISOLATABLE_BY_KIND[kind]
    attachRequestErrorMeta(this, META_BY_KIND[kind])
  }
}
