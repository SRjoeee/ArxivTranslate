// Provider 统一接口（DESIGN §8）。每个引擎一个文件，禁止跨文件共享未公开接口的细节。

export interface TranslateSegment {
  id: string
  text: string
}

export interface TranslateContext {
  paperTitle?: string
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
  /** true → markup 路径；false → runs 路径 */
  preservesMarkup: boolean
  /** 单次请求字符上限 */
  maxBatchChars: number
  /** 单次请求段落数上限 */
  maxBatchItems: number
  /** 并发上限，交给 p-queue */
  concurrency: number
  /** 健康检查：key 是否配置、端点是否可达、内置模型是否可用 */
  isAvailable(): Promise<boolean>
  translate(request: TranslateRequest): Promise<TranslateResult>
}

export type ProviderErrorKind = 'no-key' | 'network' | 'rate-limit' | 'auth' | 'invalid-response' | 'timeout' | 'aborted' | 'unknown'

export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProviderError'
  }
}
