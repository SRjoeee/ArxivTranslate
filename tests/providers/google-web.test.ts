import { describe, expect, it, vi } from 'vitest'
import { createGoogleWebProvider } from '@/providers/google-web'
import { ProviderError, type TranslateRequest } from '@/providers/types'
import { getRequestErrorMeta } from '@/providers/request/retry-policy'

const req = (texts: string[]): TranslateRequest => ({
  segments: texts.map((text, i) => ({ id: `s${i}`, text })),
  source: 'en',
  target: 'cmn',
})

const okResponse = (items: string[]) =>
  new Response(JSON.stringify([items, 'en']), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('createGoogleWebProvider', () => {
  it('sends all segments in one request and maps indexes back to IDs', async () => {
    const fetch = vi.fn(async () => okResponse(['一', '二', '三']))
    const provider = createGoogleWebProvider({ fetch: fetch as unknown as typeof globalThis.fetch })
    const result = await provider.translate(req(['one', 'two', 'three']))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://translate-pa.googleapis.com/v1/translateHtml')
    expect(JSON.parse(String(init.body))).toEqual([[['one', 'two', 'three'], 'en', 'zh'], 'wt_lib'])
    expect(result.segments).toEqual([{ id: 's0', text: '一' }, { id: 's1', text: '二' }, { id: 's2', text: '三' }])
    expect(result.provider).toBe('google-web')
  })

  it('passes placeholders through unchanged on the markup path', async () => {
    const text = 'Let <x id="1"/> be a <t id="2">connected</t> graph.'
    const translated = '让 <x id="1"/> 是一个 <t id="2">连通的</t> 图。'
    const provider = createGoogleWebProvider({ fetch: (async () => okResponse([translated])) as unknown as typeof globalThis.fetch })
    const result = await provider.translate(req([text]))
    expect(result.segments[0]?.text).toBe(translated)
    expect(provider.preservesMarkup).toBe(true)
  })

  it('empty input makes no network request', async () => {
    const fetch = vi.fn()
    const provider = createGoogleWebProvider({ fetch: fetch as unknown as typeof globalThis.fetch })
    expect(await provider.translate(req([]))).toEqual({ segments: [], provider: 'google-web' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('classifies 429 as rate-limit and retains response headers for backoff', async () => {
    const response = new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } })
    const provider = createGoogleWebProvider({ fetch: (async () => response) as unknown as typeof globalThis.fetch })
    const error = await provider.translate(req(['x'])).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).kind).toBe('rate-limit')
    expect(getRequestErrorMeta(error).statusCode).toBe(429)
  })

  it('classifies other non-2xx responses as retryable network errors', async () => {
    const provider = createGoogleWebProvider({ fetch: (async () => new Response('boom', { status: 503 })) as unknown as typeof globalThis.fetch })
    const error = await provider.translate(req(['x'])).catch((e: unknown) => e)
    expect((error as ProviderError).kind).toBe('network')
    expect(getRequestErrorMeta(error).statusCode).toBe(503)
  })

  it('classifies fetch errors as retryable network errors', async () => {
    const provider = createGoogleWebProvider({ fetch: (async () => { throw new Error('dns') }) as unknown as typeof globalThis.fetch })
    const error = await provider.translate(req(['x'])).catch((e: unknown) => e)
    expect((error as ProviderError).kind).toBe('network')
    expect(getRequestErrorMeta(error).isRetryable).toBe(true)
  })

  it('classifies cancelled requests as aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = createGoogleWebProvider({ fetch: (async () => { throw new Error('aborted') }) as unknown as typeof globalThis.fetch })
    const error = await provider.translate({ ...req(['x']), signal: controller.signal }).catch((e: unknown) => e)
    expect((error as ProviderError).kind).toBe('aborted')
  })

  it('classifies mismatched counts or malformed structures as invalid-response', async () => {
    const short = createGoogleWebProvider({ fetch: (async () => okResponse(['只有一条'])) as unknown as typeof globalThis.fetch })
    const e1 = await short.translate(req(['a', 'b'])).catch((e: unknown) => e)
    expect((e1 as ProviderError).kind).toBe('invalid-response')
    expect((e1 as Error).message).toContain('expected 2')

    const weird = createGoogleWebProvider({ fetch: (async () => new Response('{"nope":1}', { status: 200 })) as unknown as typeof globalThis.fetch })
    const e2 = await weird.translate(req(['a'])).catch((e: unknown) => e)
    expect((e2 as ProviderError).kind).toBe('invalid-response')
  })

  it('the free endpoint needs no credentials and isAvailable is always true', async () => {
    expect(await createGoogleWebProvider().isAvailable()).toBe(true)
  })
})

describe('HTTP status to error kind (Codex #17)', () => {
  const respond = (status: number) => createGoogleWebProvider({
    fetch: async () => new Response('{}', { status, statusText: 'x' }),
  }).translate({ segments: [{ id: 'a', text: 'A' }], source: 'en', target: 'cmn' })

  it('4xx must not become network: retry-policy checks kind before status and treats network errors as retryable.', async () => {
    // 400 is nonretryable bad-request; classifying it as network would retry a doomed request three times before splitting it.
    await expect(respond(400)).rejects.toMatchObject({ kind: 'bad-request' })
    await expect(respond(404)).rejects.toMatchObject({ kind: 'bad-request' })
  })

  it('classifies 401 and 403 as auth, and 429 as rate-limit', async () => {
    await expect(respond(401)).rejects.toMatchObject({ kind: 'auth' })
    await expect(respond(403)).rejects.toMatchObject({ kind: 'auth' })
    await expect(respond(429)).rejects.toMatchObject({ kind: 'rate-limit' })
  })

  it('408, 409, and 5xx remain transient and retryable', async () => {
    for (const status of [408, 409, 500, 502, 503]) {
      await expect(respond(status)).rejects.toMatchObject({ kind: 'network' })
    }
  })

  it('bad-request is nonretryable but still triggers fallback because another engine may succeed', async () => {
    const { getRequestErrorMeta } = await import('@/providers/request/retry-policy')
    const error = await respond(400).catch(e => e as Error)
    expect(getRequestErrorMeta(error).isRetryable).toBe(false)
    const { FALLBACK_KINDS } = await import('@/providers/fallback')
    expect(FALLBACK_KINDS.has('bad-request')).toBe(true)
  })
})
