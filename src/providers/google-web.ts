// Ported from reference/read-frog/src/utils/host/translate/api/google.ts@9b44f82 (GPL-3.0), 2026-09-04; modified:
// Kept endpoint, public API-key constant, request shape and response parsing. Added multi-item requests (upstream sends one; endpoint accepts arrays:
// 150 items in 556 ms, RESEARCH.md §6.6). Removed preserveLineBreaks markers:
// our placeholder text is sent unchanged as HTML. Removed escapeText (protector already escapes text).
import { toBcp47 } from '@/config/languages'
import { attachRequestErrorMeta } from './request/retry-policy'
import { ProviderError, type ProviderErrorKind, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'

const ENDPOINT = 'https://translate-pa.googleapis.com/v1/translateHtml'
/** Public constant from Google Translate's web client; not a user credential. */
const API_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'
const CLIENT = 'wt_lib'

export interface GoogleWebDeps {
  fetch?: typeof globalThis.fetch
}

/**
 * Map HTTP status to error kind (Codex #17). **Do not classify all 4xx as `network`**:
 * retry-policy checks kind before status, and treats network as retryable.
 * An unrecoverable 400 would be retried three times, then split into smaller batches and individual requests by BatchQueue,
 * multiplying a 100-segment batch into dozens of useless calls. Only 5xx and connection failures are transient.
 */
function kindOfStatus(status: number): ProviderErrorKind {
  if (status === 429) return 'rate-limit'
  if (status === 401 || status === 403) return 'auth'
  // Treat 408 timeout and 409 conflict as transient per retry-policy; let it decide by status code.
  if (status >= 400 && status < 500 && status !== 408 && status !== 409) return 'bad-request'
  return 'network'
}

/** The endpoint returns a translation array matching the items array length. */
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
    if (signal?.aborted) throw new ProviderError('aborted', 'Request cancelled', { cause: error })
    throw attachRequestErrorMeta(
      new ProviderError('network', `Network error: ${error instanceof Error ? error.message : String(error)}`, { cause: error }),
      { kind: 'network', isRetryable: true },
    )
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw attachRequestErrorMeta(
      new ProviderError(kindOfStatus(response.status), `translateHtml ${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 200)}` : ''}`),
      { statusCode: response.status, responseHeaders: response.headers },
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    // A non-JSON response is systemic; smaller batches cannot fix it (§8.3).
    throw new ProviderError('invalid-response', 'translateHtml returned non-JSON data', { cause: error, isolatable: false })
  }

  const translated = Array.isArray(payload) ? payload[0] : undefined
  if (!Array.isArray(translated) || translated.some(item => typeof item !== 'string')) {
    throw new ProviderError('invalid-response', `Unexpected translateHtml response format: ${JSON.stringify(payload).slice(0, 200)}`, { isolatable: false })
  }
  if (translated.length !== items.length) {
    throw new ProviderError('invalid-response', `translateHtml returned ${translated.length} items; expected ${items.length}`)
  }
  return translated as string[]
}

/**
 * Free Google web translation endpoint. Treat it as unstable (DESIGN §8.3): classify errors separately and allow provider fallback.
 * Preserves placeholders, so it uses the markup path (RESEARCH.md §6.6).
 */
export function createGoogleWebProvider(deps: GoogleWebDeps = {}): TranslationProvider {
  return {
    id: 'google-web',
    displayName: 'Google web translation (free)',
    kind: 'mt',
    preservesMarkup: true,
    // The endpoint accepts large batches; use large batches and a restrained rate, since the default 8/s is too aggressive (DESIGN §8.3).
    maxBatchChars: 8000,
    maxBatchItems: 100,
    // Originally p-queue concurrency: 2 (two in flight, no rate limit). The 2026-09-05 RequestQueue port mistakenly used rate: 2
    // (two/second): Google's median response was 63 ms, but the token bucket allowed only one request every 500 ms.
    // A 216-block paper took 29.6s (§8.3). Restore concurrency 2; rate is only a burst safety gate.
    // The rate gate should cover pathological cases, **not constrain normal traffic**: at 63 ms and concurrency 2, throughput is about 30/s.
    // 20/s is rarely reached; initially using 4/s repeated the same mistake, bottlenecking 24 requests at 5.3s.
    rateLimit: { rate: 20, capacity: 8 },
    maxConcurrent: 2,
    async isAvailable() {
      // No credentials needed; actual requests test reachability, with failures handled by the fallback chain.
      return true
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (request.segments.length === 0) return { segments: [], provider: 'google-web' }
      const texts = await translateHtml(
        request.segments.map(segment => segment.text),
        request.source,
        // The endpoint accepts BCP-47 targets; configuration stores ISO 639-3.
        toBcp47(request.target),
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
