// Ported from reference/read-frog/src/utils/host/translate/api/google.ts@9b44f82 (GPL-3.0), 2026-09-04, modified:
// the endpoint, the API key constant, the request body shape and the response parsing are taken as is; changed to send
// many items per request (upstream sends one; the endpoint accepts an array — 150 items in 556 ms, RESEARCH.md §6.6);
// the preserveLineBreaks markers are dropped (we send placeholder-marked text in html format as is) and so is the
// escapeText dependency (the protector already escapes).
import { toBcp47 } from '@/config/languages'
import { kindOfStatus } from './http-errors'
import { attachRequestErrorMeta } from './request/retry-policy'
import { ProviderError, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'
import { WIRE_FORMATS } from './wire-formats'

const ENDPOINT = 'https://translate-pa.googleapis.com/v1/translateHtml'
/** A public constant from Google Translate's web app; not a user credential */
const API_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'
const CLIENT = 'wt_lib'

export interface GoogleWebDeps {
  fetch?: typeof globalThis.fetch
}

/** The endpoint answers the items array with a translations array of the same length */
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
    if (signal?.aborted) throw new ProviderError('aborted', 'request cancelled', { cause: error })
    throw attachRequestErrorMeta(
      new ProviderError('network', `network error: ${error instanceof Error ? error.message : String(error)}`, { cause: error }),
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
    // The whole response is not JSON: a smaller batch would come back the same (§8.3)
    throw new ProviderError('invalid-response', 'translateHtml did not return JSON', { cause: error, isolatable: false })
  }

  const translated = Array.isArray(payload) ? payload[0] : undefined
  if (!Array.isArray(translated) || translated.some(item => typeof item !== 'string')) {
    throw new ProviderError('invalid-response', `unexpected translateHtml response shape: ${JSON.stringify(payload).slice(0, 200)}`, { isolatable: false })
  }
  if (translated.length !== items.length) {
    throw new ProviderError('invalid-response', `translateHtml returned ${translated.length} items, expected ${items.length}`)
  }
  return translated as string[]
}

/**
 * The free endpoint of Google Translate's web app. Taken as liable to break any time (DESIGN §8.3): its errors are
 * classified on their own, and a failure falls back to another provider. It keeps placeholder tags, so the tags path (RESEARCH.md §6.6).
 */
export function createGoogleWebProvider(deps: GoogleWebDeps = {}): TranslationProvider {
  return {
    id: 'google-web',
    kind: 'mt',
    // Keeps both (measured: tags 100%, markers 98.9%), tags first: it also keeps inline styling. Precisely because it
    // keeps both, it stays on the chain as the fallback when Microsoft is chosen (the intersection negotiation of §8.5)
    wireFormats: WIRE_FORMATS['google-web'],
    // The endpoint takes many items at once; large batches, a low rate — a free endpoint cannot take the default 8/s (DESIGN §8.3)
    maxBatchChars: 8000,
    maxBatchItems: 100,
    // This was p-queue's concurrency: 2 (2 in flight, no rate limit). Porting RequestQueue on 2026-09-05 wrote
    // rate: 2 (2 a second) by mistake — Google's median response is only 63 ms, yet the token bucket held one every
    // 500 ms, and a paper of 216 blocks took 29.6 seconds (measured, §8.3). The concurrency cap is back at 2, and the
    // rate is only a safety gate for bursts: **it must not become the ordinary constraint** — at 63 ms and
    // concurrency 2 the natural throughput is about 30/s, 20/s is hardly touched; set at 4/s first it became the new bottleneck (24 requests ran 5.3 seconds), the same mistake again
    rateLimit: { rate: 20, capacity: 8 },
    maxConcurrent: 2,
    async isAvailable() {
      // A free endpoint needs no credential; reachability is left to the real request, and a failure takes the fallback chain
      return true
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (request.segments.length === 0) return { segments: [], provider: 'google-web' }
      const texts = await translateHtml(
        request.segments.map(segment => segment.text),
        request.source,
        // The endpoint takes the target language as BCP-47; the configuration stores ISO 639-3
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
