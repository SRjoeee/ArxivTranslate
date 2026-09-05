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
  it('一次请求带上全部段落，按下标映射回 id', async () => {
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

  it('占位符原样穿过（端点保留标记，走 markup 路径）', async () => {
    const text = 'Let <x id="1"/> be a <t id="2">connected</t> graph.'
    const translated = '让 <x id="1"/> 是一个 <t id="2">连通的</t> 图。'
    const provider = createGoogleWebProvider({ fetch: (async () => okResponse([translated])) as unknown as typeof globalThis.fetch })
    const result = await provider.translate(req([text]))
    expect(result.segments[0]?.text).toBe(translated)
    expect(provider.preservesMarkup).toBe(true)
  })

  it('空请求不发网络请求', async () => {
    const fetch = vi.fn()
    const provider = createGoogleWebProvider({ fetch: fetch as unknown as typeof globalThis.fetch })
    expect(await provider.translate(req([]))).toEqual({ segments: [], provider: 'google-web' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('429 归类为 rate-limit 并带上响应头供退避使用', async () => {
    const response = new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } })
    const provider = createGoogleWebProvider({ fetch: (async () => response) as unknown as typeof globalThis.fetch })
    const error = await provider.translate(req(['x'])).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).kind).toBe('rate-limit')
    expect(getRequestErrorMeta(error).statusCode).toBe(429)
  })

  it('其他非 2xx 归类为 network 且可重试', async () => {
    const provider = createGoogleWebProvider({ fetch: (async () => new Response('boom', { status: 503 })) as unknown as typeof globalThis.fetch })
    const error = await provider.translate(req(['x'])).catch((e: unknown) => e)
    expect((error as ProviderError).kind).toBe('network')
    expect(getRequestErrorMeta(error).statusCode).toBe(503)
  })

  it('fetch 抛错归类为 network 且标记可重试', async () => {
    const provider = createGoogleWebProvider({ fetch: (async () => { throw new Error('dns') }) as unknown as typeof globalThis.fetch })
    const error = await provider.translate(req(['x'])).catch((e: unknown) => e)
    expect((error as ProviderError).kind).toBe('network')
    expect(getRequestErrorMeta(error).isRetryable).toBe(true)
  })

  it('已取消时归类为 aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = createGoogleWebProvider({ fetch: (async () => { throw new Error('aborted') }) as unknown as typeof globalThis.fetch })
    const error = await provider.translate({ ...req(['x']), signal: controller.signal }).catch((e: unknown) => e)
    expect((error as ProviderError).kind).toBe('aborted')
  })

  it('条数对不上或结构异常归类为 invalid-response', async () => {
    const short = createGoogleWebProvider({ fetch: (async () => okResponse(['只有一条'])) as unknown as typeof globalThis.fetch })
    const e1 = await short.translate(req(['a', 'b'])).catch((e: unknown) => e)
    expect((e1 as ProviderError).kind).toBe('invalid-response')
    expect((e1 as Error).message).toContain('期望 2 条')

    const weird = createGoogleWebProvider({ fetch: (async () => new Response('{"nope":1}', { status: 200 })) as unknown as typeof globalThis.fetch })
    const e2 = await weird.translate(req(['a'])).catch((e: unknown) => e)
    expect((e2 as ProviderError).kind).toBe('invalid-response')
  })

  it('免费端点无需凭据，isAvailable 恒为 true', async () => {
    expect(await createGoogleWebProvider().isAvailable()).toBe(true)
  })
})
