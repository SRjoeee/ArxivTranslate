// HTTP 状态 → ProviderError 分类。google-web 与 microsoft 共用：两个免费端点都要这套判断，
// 而它带着一段不能重新推导的推理（见下），只该有一处。

import type { ProviderErrorKind } from './types'

/**
 * **不能把 4xx 一律归成 `network`**（Codex 在 #17 指出）：retry-policy 的
 * `isRetryableRequestErrorMeta` 会**先看 kind 再看状态码**，`network` 直接判定可重试，
 * 于是一个永远不会成功的 400 会被重试满 3 次、再被 BatchQueue 对半拆分逐条重来——
 * 100 段的一批能放大成几十次无用请求。只有 5xx 与连接层失败才是瞬时的。
 */
export function kindOfStatus(status: number): ProviderErrorKind {
  if (status === 429) return 'rate-limit'
  if (status === 401 || status === 403) return 'auth'
  // 408 超时、409 冲突照 retry-policy 的状态码表算瞬时，交给它按状态码判定
  if (status >= 400 && status < 500 && status !== 408 && status !== 409) return 'bad-request'
  return 'network'
}
