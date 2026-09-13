// The assertion list follows the upstream reference/read-frog/src/utils/host/translate/api/__tests__/microsoft.test.ts@9b44f82,
// in the form of tests/providers/google-web.test.ts (fetch injected).
import { describe, expect, it, vi } from 'vitest'
import { getRequestErrorMeta } from '@/providers/request/retry-policy'
import { createMicrosoftProvider, supportsTarget } from '@/providers/microsoft'
import { ProviderError, type TranslateRequest } from '@/providers/types'

const req = (texts: string[], target = 'cmn'): TranslateRequest => ({
  segments: texts.map((text, i) => ({ id: `s${i}`, text })),
  source: 'en',
  target,
})

const ok = (texts: string[]) =>
  new Response(JSON.stringify(texts.map(text => ({ translations: [{ text, to: 'zh-Hans' }] }))), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const provider = (fetch: unknown, target = 'cmn') =>
  createMicrosoftProvider(target, { fetch: fetch as typeof globalThis.fetch })

const withSentLen = (items: { text: string; src: number[]; trans: number[] }[]) =>
  new Response(
    JSON.stringify(items.map(i => ({ translations: [{ text: i.text, to: 'zh-Hans', sentLen: { srcSentLen: i.src, transSentLen: i.trans } }] }))),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )

describe('sentence alignment from sentLen (#105)', () => {
  const source = 'One sentence. Two here.'
  const target = '第一句。第二句。'

  it('reads the endpoint\'s own boundaries — we neither ask for them nor pay for them', async () => {
    const fetch = vi.fn(async () => withSentLen([{ text: target, src: [14, 9], trans: [4, 4] }]))
    const result = await provider(fetch).translate(req([source]))
    expect(result.segments[0]?.alignment).toEqual({ source: [14, 9], target: [4, 4] })
    // The request body is unchanged: no extra field, no extra round trip
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual([source])
  })

  it('drops boundaries that do not add up, rather than highlighting the wrong characters', async () => {
    const fetch = vi.fn(async () => withSentLen([{ text: target, src: [14, 8], trans: [4, 4] }]))
    const result = await provider(fetch).translate(req([source]))
    expect(result.segments[0]?.text).toBe(target)
    expect(result.segments[0]?.alignment).toBeUndefined()
  })

  it('leaves the translation intact when the response carries no sentLen at all', async () => {
    const fetch = vi.fn(async () => ok([target]))
    const result = await provider(fetch).translate(req([source]))
    expect([result.segments[0]?.text, result.segments[0]?.alignment]).toEqual([target, undefined])
  })

  it('verifies each segment against its own texts, not against the batch', async () => {
    const fetch = vi.fn(async () =>
      withSentLen([
        { text: target, src: [14, 9], trans: [4, 4] },
        { text: '短句。', src: [6], trans: [3] },
      ]),
    )
    const result = await provider(fetch).translate(req([source, 'Short.']))
    expect(result.segments.map(s => s.alignment)).toEqual([{ source: [14, 9], target: [4, 4] }, { source: [6], target: [3] }])
  })
})

describe('createMicrosoftProvider', () => {
  it('a bare string array carries every segment in one go, mapped back to ids by index', async () => {
    const fetch = vi.fn(async () => ok(['一', '二', '三']))
    const result = await provider(fetch).translate(req(['one', 'two', 'three']))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    // Sent as an explicit zh-Hans, not bare zh — no reliance on how the endpoint normalises
    expect(url).toBe('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false')
    // The upstream version's shape: a bare array, not the old [{ Text }]
    expect(JSON.parse(String(init.body))).toEqual(['one', 'two', 'three'])
    expect(result.segments).toEqual([{ id: 's0', text: '一' }, { id: 's1', text: '二' }, { id: 's2', text: '三' }])
    expect(result.provider).toBe('microsoft')
  })

  it('markers pass through as they are; **no second escaping** — the protector escaped already', async () => {
    const text = '让 @a# 与 @b# 相等，且 a &lt; b'
    const fetch = vi.fn(async () => ok([text]))
    await provider(fetch).translate(req([text]))
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    // Upstream escapeText's in the adapter; we must not do it again, or &amp;lt; goes out
    expect(body).toEqual([text])
  })

  it('empty segments send no request', async () => {
    const fetch = vi.fn(async () => ok([]))
    expect((await provider(fetch).translate(req([]))).segments).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('the over-limit 400 returns plain text: not parsable as JSON, classified bad-request rather than network', async () => {
    // The measured response body is exactly this line, not JSON (RESEARCH §5.1)
    const fetch = vi.fn(async () => new Response('Request exceeds the maximum allowed translation size.', { status: 400, statusText: 'Bad Request' }))
    const error = await provider(fetch).translate(req(['one'])).catch(e => e)
    expect(error).toBeInstanceOf(ProviderError)
    // network is judged retryable by retry-policy, and a 400 bound to fail would be multiplied into dozens of requests
    expect((error as ProviderError).kind).toBe('bad-request')
    expect((error as ProviderError).message).toContain('maximum allowed translation size')
    expect(getRequestErrorMeta(error)?.statusCode).toBe(400)
  })

  it('429 goes to rate-limit with the response headers for the backoff', async () => {
    const fetch = vi.fn(async () => new Response('slow down', { status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '2' } }))
    const error = await provider(fetch).translate(req(['one'])).catch(e => e)
    expect((error as ProviderError).kind).toBe('rate-limit')
    const headers = getRequestErrorMeta(error)?.responseHeaders
    expect(headers instanceof Headers ? headers.get('retry-after') : headers?.['retry-after']).toBe('2')
  })

  it('a count mismatch / a missing translations[0].text → invalid-response', async () => {
    const short = vi.fn(async () => ok(['一']))
    expect(((await provider(short).translate(req(['a', 'b'])).catch(e => e)) as ProviderError).kind).toBe('invalid-response')
    const missing = vi.fn(async () => new Response(JSON.stringify([{ translations: [] }]), { status: 200 }))
    const error = await provider(missing).translate(req(['a'])).catch(e => e)
    expect((error as ProviderError).kind).toBe('invalid-response')
    expect((error as ProviderError).message).toContain('item 1')
  })

  it('a non-JSON response → invalid-response, and not isolatable (a smaller split fails the same)', async () => {
    const fetch = vi.fn(async () => new Response('<html>gateway</html>', { status: 200 }))
    const error = await provider(fetch).translate(req(['a'])).catch(e => e)
    expect((error as ProviderError).kind).toBe('invalid-response')
    expect((error as ProviderError).isolatable).toBe(false)
  })

  it('tag-format placeholders are blocked: the endpoint has no markup mode and cannot restore what it destroys (the upstream hard failure, copied)', async () => {
    const fetch = vi.fn(async () => ok(['x']))
    const error = await provider(fetch).translate(req(['Let <x id="1"/> be'])).catch(e => e)
    expect((error as ProviderError).kind).toBe('bad-request')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a cancellation reports aborted and is not retried as a network error', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = vi.fn(async () => { throw new Error('aborted') })
    const error = await provider(fetch).translate({ ...req(['a']), signal: controller.signal }).catch(e => e)
    expect((error as ProviderError).kind).toBe('aborted')
  })

  it('keeps markers only: measured tags 0%, markers 98% (RESEARCH §5.1)', () => {
    expect(provider(vi.fn()).wireFormats).toEqual(['markers'])
  })
})

describe('supportsTarget', () => {
  it('supported target languages are true, Chinese included, which holds only through the primary-language fallback', () => {
    // The table has zh-Hans / zh-Hant only, no bare zh; toBcp47('cmn') gives zh, and
    // measured, to=zh returns 200 normalised to zh-Hans. An exact match would judge the default target unsupported
    for (const code of ['cmn', 'cmn-Hant', 'jpn', 'fra', 'deu', 'rus', 'kor']) {
      expect([code, supportsTarget(code)]).toEqual([code, true])
    }
  })

  it('target languages the endpoint does not support are false: 71 of 179 (RESEARCH §5.1)', () => {
    // Measured: these all return 400
    for (const code of ['ceb', 'epo', 'tgl', 'nno', 'ckb']) {
      expect([code, supportsTarget(code)]).toEqual([code, false])
    }
  })

  it('srp sends sr-Cyrl, not bare sr — the endpoint normalises bare sr to Latin (Codex on #115)', async () => {
    // languages.ts writes srp as "Serbian (Cyrillic)", while toBcp47('srp') gives sr,
    // which the endpoint normalises to sr-Latn. Measured: sr-Cyrl → Неуронске…, sr → Neuronske…
    const fetch = vi.fn(async () => ok(['х']))
    await provider(fetch, 'srp').translate(req(['one'], 'srp'))
    expect(String((fetch.mock.calls[0] as unknown as [string])[0])).toContain('to=sr-Cyrl')
  })

  it('nya / lug send the three-letter code — shortened to two letters by toBcp47 they are not in the table (Codex on #115)', async () => {
    // The 179 targets were probed with toBcp47's output, so the tags nya / lug themselves were never tried.
    // Follow-up (2026-09-09): to=ny 400, to=nya 200 “Neural network imagwirizana.”;
    //                        to=lg 400, to=lug 200 “Neural network ekwatagana.”
    for (const [code, wire] of [['nya', 'nya'], ['lug', 'lug']] as const) {
      expect([code, supportsTarget(code)]).toEqual([code, true])
      const fetch = vi.fn(async () => ok(['x']))
      await provider(fetch, code).translate(req(['one'], code))
      expect(String((fetch.mock.calls[0] as unknown as [string])[0])).toContain(`to=${wire}`)
    }
  })

  it('bos / uzn / azj, whose Cyrillic the endpoint cannot deliver, are judged unsupported rather than silently swapped for Latin (Codex on #115)', () => {
    // These three are written “(Cyrillic)” in languages.ts, but the bs / uz / az toBcp47 gives fall inside the table,
    // measured 200 yet returning Latin, while bs-Cyrl / uz-Cyrl / az-Cyrl all 400. The same family as zlm, only here
    // the two-letter code happens to be in the table and must be blocked explicitly. Mutation check: removing the three SCRIPT_UNAVAILABLE entries turns all red
    for (const code of ['bos', 'uzn', 'azj']) {
      expect([code, supportsTarget(code)]).toEqual([code, false])
    }
    // The one of the family the endpoint really delivers is unaffected: sr-Cyrl measured 200 and Cyrillic
    expect(supportsTarget('srp')).toBe(true)
  })

  it('aliases admit only those measured to pass: zlm → ms-Arab returns 400 from the endpoint and cannot be inferred supported from the primary language (Codex on #115)', () => {
    // toBcp47('zlm') deliberately gives ms-Arab for Jawi; ms-Arab measured 400, only ms is 200 and Latin-script Malay,
    // and normalising to it quietly swaps the script. A generic primary-language fallback would judge it supported
    expect(supportsTarget('zlm')).toBe(false)
    // The four measured aliases still hold
    for (const code of ['cmn', 'cmn-Hant', 'mon', 'srp']) {
      expect([code, supportsTarget(code)]).toEqual([code, true])
    }
  })

  it('an unsupported target language fails locally without asking the endpoint (Codex on #115)', async () => {
    // buildChain keeps an unavailable first choice at the head of the chain, and fallback.ts picks steps by the demotion record, not isAvailable(),
    // so without a local block the first batch would really go out and come back 400
    const fetch = vi.fn(async () => ok(['x']))
    const error = await provider(fetch, 'epo').translate(req(['one'], 'epo')).catch(e => e)
    expect((error as ProviderError).kind).toBe('bad-request')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('isAvailable() is that gate: an unsupported language reports unavailable outright, and the chain skips it of itself', async () => {
    expect(await createMicrosoftProvider('cmn').isAvailable()).toBe(true)
    expect(await createMicrosoftProvider('epo').isAvailable()).toBe(false)
  })
})
