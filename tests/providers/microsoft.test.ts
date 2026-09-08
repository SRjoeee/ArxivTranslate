// 断言清单参考上游 reference/read-frog/src/utils/host/translate/api/__tests__/microsoft.test.ts@9b44f82，
// 形式照 tests/providers/google-web.test.ts（注入 fetch）。
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

describe('createMicrosoftProvider', () => {
  it('裸字符串数组一次带上全部段落，按下标映射回 id', async () => {
    const fetch = vi.fn(async () => ok(['一', '二', '三']))
    const result = await provider(fetch).translate(req(['one', 'two', 'three']))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://edge.microsoft.com/translate/translatetext?from=en&to=zh&isEnterpriseClient=false')
    // 上游那版的形状：裸数组，不是旧的 [{ Text }]
    expect(JSON.parse(String(init.body))).toEqual(['one', 'two', 'three'])
    expect(result.segments).toEqual([{ id: 's0', text: '一' }, { id: 's1', text: '二' }, { id: 's2', text: '三' }])
    expect(result.provider).toBe('microsoft')
  })

  it('source 为 auto 时 from 留空，让端点自己检测（照搬上游）', async () => {
    const fetch = vi.fn(async () => ok(['一']))
    await provider(fetch).translate({ ...req(['one']), source: 'auto' })
    expect(String((fetch.mock.calls[0] as unknown as [string])[0])).toContain('from=&to=zh')
  })

  it('记号原样穿过；**不再二次转义**——protector 已经转过了', async () => {
    const text = '让 @a# 与 @b# 相等，且 a &lt; b'
    const fetch = vi.fn(async () => ok([text]))
    await provider(fetch).translate(req([text]))
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    // 上游在适配器里 escapeText，我们不能再来一遍，否则发出去的是 &amp;lt;
    expect(body).toEqual([text])
  })

  it('段落为空不发请求', async () => {
    const fetch = vi.fn(async () => ok([]))
    expect((await provider(fetch).translate(req([]))).segments).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('超限的 400 返回纯文本：不能当 JSON 解，归 bad-request 而不是 network', async () => {
    // 实测响应体就是这一行，不是 JSON（RESEARCH §5.1）
    const fetch = vi.fn(async () => new Response('Request exceeds the maximum allowed translation size.', { status: 400, statusText: 'Bad Request' }))
    const error = await provider(fetch).translate(req(['one'])).catch(e => e)
    expect(error).toBeInstanceOf(ProviderError)
    // network 会被 retry-policy 判成可重试，一个必然失败的 400 会被放大成几十次请求
    expect((error as ProviderError).kind).toBe('bad-request')
    expect((error as ProviderError).message).toContain('maximum allowed translation size')
    expect(getRequestErrorMeta(error)?.statusCode).toBe(400)
  })

  it('429 归 rate-limit，带上响应头给退避用', async () => {
    const fetch = vi.fn(async () => new Response('slow down', { status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '2' } }))
    const error = await provider(fetch).translate(req(['one'])).catch(e => e)
    expect((error as ProviderError).kind).toBe('rate-limit')
    expect(getRequestErrorMeta(error)?.responseHeaders?.get('retry-after')).toBe('2')
  })

  it('条数不符 / 缺 translations[0].text → invalid-response', async () => {
    const short = vi.fn(async () => ok(['一']))
    expect(((await provider(short).translate(req(['a', 'b'])).catch(e => e)) as ProviderError).kind).toBe('invalid-response')
    const missing = vi.fn(async () => new Response(JSON.stringify([{ translations: [] }]), { status: 200 }))
    const error = await provider(missing).translate(req(['a'])).catch(e => e)
    expect((error as ProviderError).kind).toBe('invalid-response')
    expect((error as ProviderError).message).toContain('第 1 条')
  })

  it('响应不是 JSON → invalid-response，且不可拆分（拆小了也一样）', async () => {
    const fetch = vi.fn(async () => new Response('<html>gateway</html>', { status: 200 }))
    const error = await provider(fetch).translate(req(['a'])).catch(e => e)
    expect((error as ProviderError).kind).toBe('invalid-response')
    expect((error as ProviderError).isolatable).toBe(false)
  })

  it('标签格式的占位符被挡下：端点没有 markup 模式，毁了没法还原（照搬上游的硬失败）', async () => {
    const fetch = vi.fn(async () => ok(['x']))
    const error = await provider(fetch).translate(req(['Let <x id="1"/> be'])).catch(e => e)
    expect((error as ProviderError).kind).toBe('bad-request')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('取消时报 aborted，不当成网络错误重试', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = vi.fn(async () => { throw new Error('aborted') })
    const error = await provider(fetch).translate({ ...req(['a']), signal: controller.signal }).catch(e => e)
    expect((error as ProviderError).kind).toBe('aborted')
  })

  it('只保得住 markers：实测标签 0%、记号 98%（RESEARCH §5.1）', () => {
    expect(provider(vi.fn()).wireFormats).toEqual(['markers'])
  })
})

describe('supportsTarget', () => {
  it('支持的目标语言为真，包括要靠主语言回退才成立的中文', () => {
    // 表里只有 zh-Hans / zh-Hant，没有裸 zh；而 toBcp47('cmn') 给出 zh，
    // 实测 to=zh 返回 200 并归一成 zh-Hans。精确匹配会把默认目标判成不支持
    for (const code of ['cmn', 'cmn-Hant', 'jpn', 'fra', 'deu', 'rus', 'kor']) {
      expect([code, supportsTarget(code)]).toEqual([code, true])
    }
  })

  it('端点不支持的目标语言为假：179 个里有 71 个（RESEARCH §5.1）', () => {
    // 实测这几个都返回 400
    for (const code of ['ceb', 'epo', 'tgl', 'nno', 'ckb']) {
      expect([code, supportsTarget(code)]).toEqual([code, false])
    }
  })

  it('isAvailable() 就是这道闸：不支持的语言直接报不可用，链会自动跳过它', async () => {
    expect(await createMicrosoftProvider('cmn').isAvailable()).toBe(true)
    expect(await createMicrosoftProvider('epo').isAvailable()).toBe(false)
  })
})
