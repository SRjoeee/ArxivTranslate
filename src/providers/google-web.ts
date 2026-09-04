// 移植自 reference/read-frog/src/utils/host/translate/api/google.ts@9b44f82（GPL-3.0），有修改：
// 端点、API key 常量、请求体形状与响应解析照搬；改为一次请求多条（原版一次一条，端点本身支持数组，
// 实测 150 条 556 ms，见 RESEARCH.md §6.6）；去掉 preserveLineBreaks 那套换行标记——
// 我们送的是占位符标记文本，走 html 格式原样发送；去掉 escapeText 依赖（protector 已做转义）。
import { attachRequestErrorMeta } from './retry-policy'
import { ProviderError, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'

const ENDPOINT = 'https://translate-pa.googleapis.com/v1/translateHtml'
/** 公开常量，来自 Google 翻译网页版；不是用户凭据 */
const API_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'
const CLIENT = 'wt_lib'

export interface GoogleWebDeps {
  fetch?: typeof globalThis.fetch
}

/** 端点按 items 数组返回同长度的译文数组 */
async function translateHtml(items: string[], from: string, to: string, deps: GoogleWebDeps, signal?: AbortSignal): Promise<string[]> {
  const doFetch = deps.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await doFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-API-Key': API_KEY },
      body: JSON.stringify([[items, from, to], CLIENT]),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw new ProviderError('aborted', '请求已取消', { cause: error })
    throw attachRequestErrorMeta(
      new ProviderError('network', `网络错误：${error instanceof Error ? error.message : String(error)}`, { cause: error }),
      { kind: 'network', isRetryable: true },
    )
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const kind = response.status === 429 ? 'rate-limit' : 'network'
    throw attachRequestErrorMeta(
      new ProviderError(kind, `translateHtml ${response.status} ${response.statusText}${detail ? `：${detail.slice(0, 200)}` : ''}`),
      { statusCode: response.status, responseHeaders: response.headers },
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new ProviderError('invalid-response', 'translateHtml 返回的不是 JSON', { cause: error })
  }

  const translated = Array.isArray(payload) ? payload[0] : undefined
  if (!Array.isArray(translated) || translated.some(item => typeof item !== 'string')) {
    throw new ProviderError('invalid-response', `translateHtml 响应格式异常：${JSON.stringify(payload).slice(0, 200)}`)
  }
  if (translated.length !== items.length) {
    throw new ProviderError('invalid-response', `translateHtml 返回 ${translated.length} 条，期望 ${items.length} 条`)
  }
  return translated as string[]
}

/**
 * Google 网页版翻译的免费端点。视为随时会断（DESIGN §8.3）：错误独立分类，失败可回退到别的 provider。
 * 保留占位符标记，所以走 markup 路径（RESEARCH.md §6.6）。
 */
export function createGoogleWebProvider(deps: GoogleWebDeps = {}): TranslationProvider {
  return {
    id: 'google-web',
    displayName: 'Google 网页翻译（免费）',
    kind: 'mt',
    preservesMarkup: true,
    // 端点一次能吃很多条；批次给大、并发给小（DESIGN §8.3）
    maxBatchChars: 8000,
    maxBatchItems: 100,
    concurrency: 2,
    async isAvailable() {
      // 免费端点不需要凭据；是否可达留给实际请求，失败走 fallback 链
      return true
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (request.segments.length === 0) return { segments: [], provider: 'google-web' }
      const texts = await translateHtml(
        request.segments.map(segment => segment.text),
        request.source,
        request.target,
        deps,
        request.signal,
      )
      return {
        segments: request.segments.map((segment, i) => ({ id: segment.id, text: texts[i]! })),
        provider: 'google-web',
      }
    },
  }
}
