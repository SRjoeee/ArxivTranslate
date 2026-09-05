// Chrome 内置翻译（DESIGN §8.4，Phase 0 实测见 RESEARCH §6）。离线、免 key、单句 10–20 ms，
// 是降级链上唯一不依赖网络也不花钱的一环。隔离世界同样暴露 `Translator`（2026-09-05 实测，RESEARCH §6.3）。
//
// 硬规则 4：免费接口视为不稳定——错误独立分类，失败可回退到链上的下一个引擎。
import { toBcp47 } from '@/config/languages'
import { ProviderError, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'

/** 只用到静态的两个方法；注入以便测试（happy-dom 里没有这个全局） */
export interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>
  create(options: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal; monitor?: (m: unknown) => void }): Promise<TranslatorSession>
}

export interface TranslatorSession {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>
}

export interface ChromeBuiltinDeps {
  /** 默认取全局 `Translator`；拿不到就是这个浏览器不支持 */
  translator?: TranslatorApi | null
}

export const BUILTIN_SOURCE_LANGUAGE = 'en'

/** 单批最多同时推理多少条；也是 provider 声明的 maxBatchItems */
export const BUILTIN_MAX_ITEMS = 20

function globalTranslator(): TranslatorApi | null {
  const api = (globalThis as { Translator?: TranslatorApi }).Translator
  return api && typeof api.availability === 'function' ? api : null
}

/**
 * 中日韩标点后面多出来的空格：模型逐句翻译后用空格拼接，中文里就成了「。 我们」。
 * 实测见 RESEARCH §6.2。归一化是这个引擎自己的事，不进 protector——占位符协议不关心排版空格。
 */
export function normalizeSpacing(text: string): string {
  return text.replace(/([。，、；：？！）」』】])[ \t]+/g, '$1')
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  const name = (e as { name?: unknown })?.name
  const message = e instanceof Error ? e.message : String(e)
  // 没有用户手势就 create()：链上自动降级时拿不到手势，重试也没用，按"配置未就绪"处理，让链永久降级它
  if (name === 'NotAllowedError') return new ProviderError('no-key', `内置翻译需要用户手势下载语言包：${message}`, { cause: e })
  if (name === 'NotSupportedError') return new ProviderError('no-key', `这个语言对不支持内置翻译：${message}`, { cause: e })
  if (name === 'AbortError') return new ProviderError('aborted', '请求已取消', { cause: e })
  return new ProviderError('unknown', message, { cause: e })
}

/**
 * @param target 目标语言的 ISO 639-3 码（配置里的形状）；内部转成 BCP-47 给 API
 */
export function createChromeBuiltinProvider(target: string, deps: ChromeBuiltinDeps = {}): TranslationProvider {
  const api = deps.translator === undefined ? globalTranslator() : deps.translator
  const targetLanguage = toBcp47(target)
  const pair = { sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage }
  /**
   * 会话按语言对缓存（照 KISS builtinAI.js 的 #translatorMap）：模型就绪后 create() 仍要约 8.6 s 本地加载
   *（RESEARCH §6.1），每批新建会话会把 10 ms 的翻译拖成秒级。缓存 Promise 而不是实例，失败时删掉以便重试
   */
  const sessions = new Map<string, Promise<TranslatorSession>>()

  /**
   * **不接任何一批的 signal**：会话是所有批次共用的，模型加载要几秒到十几秒，
   * 期间并发的批次都在等同一个 Promise。把首个批次的 signal 传给 create()，
   * 那一批一超时就会把共用的会话连根拒掉，其余批次全收到 `aborted`——
   * 而降级链对 `aborted` 既不重试也不降级，等于整页翻译在这里断掉（Codex 在 #50 指出）。
   * 单次翻译的取消仍然生效，见 translate() 里逐条传的 signal
   */
  const sessionFor = (): Promise<TranslatorSession> => {
    const key = `${pair.sourceLanguage}_${pair.targetLanguage}`
    const existing = sessions.get(key)
    if (existing) return existing
    const created = api!.create(pair).catch((e: unknown) => {
      sessions.delete(key)
      throw toProviderError(e)
    })
    sessions.set(key, created)
    return created
  }

  return {
    id: 'chrome-builtin',
    displayName: 'Chrome 内置翻译（离线）',
    kind: 'builtin',
    // 实测保留 HTML 标签与 void / paired 占位符（RESEARCH §6.2），走 markup 路径
    preservesMarkup: true,
    // 本地推理没有网络往返，批大一点省调度开销
    maxBatchChars: 4000,
    maxBatchItems: BUILTIN_MAX_ITEMS,
    // 本地不需要限流，但保留闸门，免得一次涌入几百条把主线程排满
    rateLimit: { rate: 20, capacity: 20 },
    async isAvailable() {
      if (!api) return false
      try {
        // 只认 available：downloadable / downloading 都要用户手势才能 create()，
        // 链上自动降级时拿不到手势。下载入口在 popup（§8.4）
        return (await api.availability(pair)) === 'available'
      } catch {
        return false
      }
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (request.segments.length === 0) return { segments: [], provider: 'chrome-builtin' }
      if (!api) throw new ProviderError('no-key', '这个浏览器没有内置翻译 API')
      const session = await sessionFor()
      try {
        // **按自己声明的上限分批**：批次是 pipeline 按**首选**引擎的上限规划的，
        // 降级链把同一个调用原样转过来——首选是 google-web（8000 字 / 100 条）时，
        // 这里会一口气对本地模型发起 100 个并发推理，正好在需要兜底的时候把它压垮（Codex 在 #50 指出）
        const texts: string[] = []
        for (let i = 0; i < request.segments.length; i += BUILTIN_MAX_ITEMS) {
          const chunk = request.segments.slice(i, i + BUILTIN_MAX_ITEMS)
          texts.push(...await Promise.all(chunk.map(segment =>
            session.translate(segment.text, request.signal ? { signal: request.signal } : undefined),
          )))
        }
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
