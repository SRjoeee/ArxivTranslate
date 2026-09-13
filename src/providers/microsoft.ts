// Ported from reference/read-frog/src/utils/host/translate/api/microsoft.ts@9b44f82 (GPL-3.0), 2026-09-08, modified.
// The endpoint, the query parameters (including `from=auto` → empty string), the bare-string-array request body, the
// `translations[0].text` response parsing and the per-item missing check are taken as is; compared against
// reference/FluentRead/src/providers/translation/microsoft.ts, which has the same shape.
//
// Four changes:
// 1. **Upstream's escapeText / escapeHtmlText are dropped.** Both upstreams escape in the adapter because their
//    pipelines do not; our protector has already escaped (markers format, #107), and escaping again would send `<` as
//    `&amp;lt;`. The same change was made when google-web.ts was ported. A side difference: upstream also escapes
//    `"` and `'`, we do not — the marker aligner watches `<` and `&`, quotes only matter inside attributes, and this
//    line is plain text with no tags.
// 2. Upstream's hard failure on `textFormat === 'html'` → blocked at negotiation with `wireFormats: ['markers']`
//    (§8.5); the defensive throw stays, in case negotiation ever lets a tag through.
// 3. Errors are wrapped in our ProviderError kinds (upstream throws a bare Error with meta), via the shared kindOfStatus.
// 4. Batch size, concurrency and rate follow **our own measurements** of the Microsoft endpoint (below); upstream only
//    has global settings, no per-provider values.
//
// The key fact from the upstream comment: **the endpoint runs its HTML markup aligner on every request**, and a bare
// `<` fuses into a pseudo-tag (`a < b and c > d` → `<B和C> d`). Read Frog's translation-output-normalization.ts puts
// it plainly: “Google and Microsoft both parse the request as HTML, so the adapters escape before sending, responses
// stay HTML-encoded, and decoding happens once, here”. Our protector has exactly that shape (serialize escapes, rehydrate / joinRuns decode once).
import { toBcp47 } from '@/config/languages'
import { kindOfStatus } from './http-errors'
import { attachRequestErrorMeta } from './request/retry-policy'
import { ProviderError, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'
import { WIRE_FORMATS } from './wire-formats'
import { type SentenceAlignment, verifyAlignment } from './alignment'

const ENDPOINT = 'https://edge.microsoft.com/translate/translatetext'

/**
 * The target languages the endpoint supports (BCP-47). From its own public language table, 2026-09-08:
 *
 *     curl 'https://api.cognitive.microsofttranslator.com/languages?api-version=3.0&scope=translation'
 *
 * 108 of our 179 target languages fall inside this table and 71 outside (RESEARCH §5.1). Neither upstream project has
 * this layer — Read Frog throws when its `ISO6393_TO_6391` map has no entry, failing halfway through a translation.
 */
const SUPPORTED = new Set(`
  af am ar as az ba be bg bho bn bo brx bs ca cs cy da de doi dsb dv el en es es-MX et eu fa fi fil
  fj fo fr fr-CA ga gl gom gu ha he hi hne hr hsb ht hu hy id ig ikt is it iu iu-Latn ja ka kk km kmr
  kn ko ks ku ky lb ln lo lt lug lv lzh mai mg mi mk ml mn-Cyrl mn-Mong mni mr ms mt mww my nb ne nl
  nso nya or otq pa pl prs ps pt pt-PT ro ru run rw sd si sk sl sm sn so sq sr-Cyrl sr-Latn st sv sw
  ta te th ti tk tlh-Latn tlh-Piqd tn to tr tt ty ug uk ur uz vi xh yo yua yue zh-Hans zh-Hant zu
`.trim().split(/\s+/))

/**
 * Our target language (through `toBcp47`) → **the tag actually sent to the endpoint**. Not in this table, sent as it is.
 *
 * Two things settled together: bare tags the public table lacks (`zh` / `sr` / `mn`), and **the endpoint's own
 * default normalisation disagreeing with what our language means**. The latter is a real bug: `toBcp47('srp')`
 * gives `sr`, the endpoint normalises it to **`sr-Latn`** (Latin), while our `srp` is written **Serbian (Cyrillic)**
 * in `languages.ts` — a silent change of script, the same class as `zlm → ms-Arab` (Codex on #115). Sent as
 * `sr-Cyrl` explicitly, nothing depends on the endpoint's default any more.
 *
 * Measured one by one (2026-09-09): `sr-Cyrl` → Неуронске… (Cyrillic), `sr` → Neuronske… (Latin), `mn-Cyrl` /
 * `zh-Hans` / `zh-Hant` all 200 with the right script.
 */
const REWRITE: Record<string, string> = {
  zh: 'zh-Hans',      // toBcp47('cmn'), our default target
  'zh-TW': 'zh-Hant', // toBcp47('cmn-Hant')
  mn: 'mn-Cyrl',      // the script modern Mongolian is written in; a bare mn normalises here too, written out so nothing depends on the default
  sr: 'sr-Cyrl',      // ← a bare sr would be normalised to Latin, the opposite of what our language means
  ny: 'nya',          // ↓ these two the other way round: the endpoint uses three-letter codes, `toBcp47` shortens to two letters, and the short form is not in the table
  lg: 'lug',
}

/**
 * Target languages whose **script**, as we label it, the endpoint cannot deliver. These three are written “(Cyrillic)”
 * in `languages.ts`, the endpoint table has no Cyrillic variant for them, and the `bs` / `uz` / `az` that `toBcp47`
 * gives measured Latin every time (the BCP47_OVERRIDES note of `languages.ts` records that measurement). Sent, they
 * would **silently change the script**, so they are unsupported and fall back — the same reasoning as `zlm →
 * ms-Arab` being false for not being in the table, only here the two-letter codes happen to be in it and have to be blocked explicitly (Codex on #115).
 */
const SCRIPT_UNAVAILABLE = new Set(['bos', 'uzn', 'azj'])

/** The target-language tag actually sent to the endpoint */
function wireTarget(target: string): string {
  const tag = toBcp47(target)
  return REWRITE[tag] ?? tag
}

/**
 * Can this target language be translated. After the rewrite every tag lands on a real entry of the public table, so
 * the test is one “is it in the table” — no inference by primary language (the first version did that and judged `zlm → ms-Arab` supported, which measured 400).
 */
export function supportsTarget(target: string): boolean {
  if (SCRIPT_UNAVAILABLE.has(target)) return false
  return SUPPORTED.has(wireTarget(target))
}

export interface MicrosoftDeps {
  fetch?: typeof globalThis.fetch
}

interface MicrosoftItem {
  translations?: { text?: string; sentLen?: { srcSentLen?: number[]; transSentLen?: number[] } }[]
}

async function translateTexts(
  texts: string[],
  from: string,
  to: string,
  deps: MicrosoftDeps,
  signal?: AbortSignal,
): Promise<{ text: string; alignment?: SentenceAlignment }[]> {
  const doFetch = deps.fetch ?? globalThis.fetch
  // Upstream also accepted 'auto' (an empty `from` lets the endpoint detect); `TranslateRequest.source` is the literal
  // `'en'` here (arXiv is English throughout), so that branch went (ADR-0001 §9)
  const query = new URLSearchParams({ from, to, isEnterpriseClient: 'false' })
  let response: Response
  try {
    response = await doFetch(`${ENDPOINT}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(texts),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw new ProviderError('aborted', 'request cancelled', { cause: error })
    throw attachRequestErrorMeta(
      new ProviderError('network', `network error: ${error instanceof Error ? error.message : String(error)}`, { cause: error }),
      { kind: 'network', isRetryable: true },
    )
  }

  // Before json(): over the limit it returns **plain text**, `Request exceeds the maximum allowed translation size.`,
  // and JSON.parse straight away would throw as invalid-response and mask the real 400 (RESEARCH §5.1)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw attachRequestErrorMeta(
      new ProviderError(kindOfStatus(response.status), `translatetext ${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 200)}` : ''}`),
      { statusCode: response.status, responseHeaders: response.headers },
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    // The whole response is not JSON: a smaller batch would come back the same (§8.3)
    throw new ProviderError('invalid-response', 'translatetext did not return JSON', { cause: error, isolatable: false })
  }

  if (!Array.isArray(payload)) {
    throw new ProviderError('invalid-response', `unexpected translatetext response shape: ${JSON.stringify(payload).slice(0, 200)}`, { isolatable: false })
  }
  if (payload.length !== texts.length) {
    throw new ProviderError('invalid-response', `translatetext returned ${payload.length} items, expected ${texts.length}`)
  }
  return payload.map((item: MicrosoftItem, i) => {
    const translation = item?.translations?.[0]
    const text = translation?.text
    if (typeof text !== 'string') throw new ProviderError('invalid-response', `translatetext item ${i + 1} has no translation`)
    // The endpoint segments internally and reports it; we neither ask for it nor pay for it.
    // Measured over 60 real blocks: the partition was complete on all 60 and 96.2% of boundaries
    // landed after sentence punctuation — but only once whitespace was collapsed (#119), which is
    // why this is worth reading at all. verifyAlignment still gates it.
    const sentLen = translation?.sentLen
    const alignment = Array.isArray(sentLen?.srcSentLen) && Array.isArray(sentLen?.transSentLen)
      ? { source: sentLen.srcSentLen, target: sentLen.transSentLen }
      : undefined
    return { text, alignment }
  })
}

/**
 * Microsoft Edge's free translation endpoint. Taken as liable to break any time (DESIGN §8.3): its errors are
 * classified on their own, and a failure falls back to another provider.
 *
 * **It keeps plain-text markers only**: the tags format measured 0% on it (all 400 placeholders lost, attribute quotes
 * turned full-width, opening tags torn into bare text), the markers format 98% (RESEARCH §5.1), so `wireFormats` is `markers` alone.
 */
export function createMicrosoftProvider(targetLanguage: string, deps: MicrosoftDeps = {}): TranslationProvider {
  return {
    id: 'microsoft',
    kind: 'mt',
    // `sentLen` is native, so the service inserts no sentence markers for it (§8.6)
    reportsSentences: true,
    wireFormats: WIRE_FORMATS.microsoft,
    /**
     * Batch size and concurrency are set by **Microsoft's own** response profile, not copied from google-web (those
     * values were tuned to Google's 63 ms responses, and copying them would repeat the mistake recorded in
     * google-web.ts). Measured 2026-09-08, every request unique in content to rule out server caching:
     *
     *   batch 414 characters → 319 ms | 2047 → 589 ms | 8125 → **1516 ms** (latency grows linearly with size)
     *   concurrency 1 → 6.8k characters/s | 4 → 13.5k | 8 → **23k**, wall clock still ~700 ms, 30 in a row with no 429
     *
     * The conclusion is **small batches + high concurrency**: throughput comes from concurrency, and the batch size only
     * sets how long the first screen waits. 8000 would make the first screen wait 1.5 seconds for no better throughput.
     * The hard cap is 50,000 characters a request (over it, a plain-text 400); 2000 leaves 25× to spare.
     */
    maxBatchChars: 2000,
    // The character cap is reached first (2000 characters is about 15 items); this value is only the uncapped safety valve
    maxBatchItems: 100,
    maxConcurrent: 8,
    // No rate limit measured; the rate is only a safety gate for bursts — concurrency 8 at about 600 ms each gives a natural throughput of about 13/s, and 20/s is never touched
    rateLimit: { rate: 20, capacity: 8 },
    async isAvailable() {
      // A free endpoint needs no credential, but **it does not translate every language**: an unsupported target is a 400.
      // Reported unavailable here, the chain skips it of itself (the same mechanism as chrome-builtin without its pack)
      return supportsTarget(targetLanguage)
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (request.segments.length === 0) return { segments: [], provider: 'microsoft' }
      // An unsupported target language **exits locally**, without asking the endpoint. `buildChain` keeps an unavailable
      // first choice at the head (the popup has to say so), while `fallback.ts` picks steps by hand-over records, not
      // `isAvailable()` — so the first batch would still go out and come back 400, several at once under concurrency (Codex on #115)
      if (!supportsTarget(request.target)) {
        throw new ProviderError('bad-request', `Microsoft translation does not support the target language ${request.target}`, { isolatable: false })
      }
      const texts = request.segments.map(segment => segment.text)
      // The negotiation layer guarantees what comes in is markers (plain text). Should that ever slip, tags must still
      // not be sent: the endpoint has no markup mode and wrecks tags in ways that vary by target language, beyond repair (upstream Read Frog's own words)
      if (texts.some(text => /<[a-z/]/i.test(text))) {
        throw new ProviderError('bad-request', 'the Microsoft endpoint does not accept tag placeholders; markers only', { isolatable: false })
      }
      const translated = await translateTexts(texts, request.source, wireTarget(request.target), deps, request.signal)
      return {
        segments: request.segments.map((segment, i) => {
          const { text, alignment } = translated[i]!
          return { id: segment.id, text, alignment: verifyAlignment(alignment, segment.text, text) }
        }),
        provider: 'microsoft',
      }
    },
  }
}
