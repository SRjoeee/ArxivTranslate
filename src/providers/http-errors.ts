// HTTP status → ProviderError kind. Shared by google-web and microsoft: both free endpoints need this judgement, and
// it carries a piece of reasoning that cannot be re-derived (below), so it lives in one place.

import type { ProviderErrorKind } from './types'

/**
 * **4xx must not be classified `network` across the board** (Codex on #17): retry-policy's
 * `isRetryableRequestErrorMeta` **reads the kind before the status code**, `network` is retryable outright, and a
 * 400 that can never succeed would be retried the full 3 times and then halved and redone item by item by
 * BatchQueue — a batch of 100 segments amplified into dozens of useless requests. Only 5xx and connection-level failures are transient.
 */
export function kindOfStatus(status: number): ProviderErrorKind {
  if (status === 429) return 'rate-limit'
  if (status === 401 || status === 403) return 'auth'
  // 408 timeout and 409 conflict count as transient by retry-policy's status table; left to it by status code
  if (status >= 400 && status < 500 && status !== 408 && status !== 409) return 'bad-request'
  return 'network'
}
