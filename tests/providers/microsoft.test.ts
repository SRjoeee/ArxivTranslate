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
    // 发的是显式的 zh-Hans，不是裸 zh——不依赖端点自己怎么归一
    expect(url).toBe('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false')
    // 上游那版的形状：裸数组，不是旧的 [{ Text }]
    expect(JSON.parse(String(init.body))).toEqual(['one', 'two', 'three'])
    expect(result.segments).toEqual([{ id: 's0', text: '一' }, { id: 's1', text: '二' }, { id: 's2', text: '三' }])
    expect(result.provider).toBe('microsoft')
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
    const headers = getRequestErrorMeta(error)?.responseHeaders
    expect(headers instanceof Headers ? headers.get('retry-after') : headers?.['retry-after']).toBe('2')
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

  it('srp 发 sr-Cyrl，不发裸 sr——裸 sr 会被端点归成拉丁文（Codex 在 #115 指出）', async () => {
    // languages.ts 里 srp 写的是 "Serbian (Cyrillic)"，而 toBcp47('srp') 给出 sr，
    // 端点把裸 sr 归一成 sr-Latn。实测：sr-Cyrl → Неуронске…，sr → Neuronske…
    const fetch = vi.fn(async () => ok(['х']))
    await provider(fetch, 'srp').translate(req(['one'], 'srp'))
    expect(String((fetch.mock.calls[0] as unknown as [string])[0])).toContain('to=sr-Cyrl')
  })

  it('别名只收实测通过的：zlm → ms-Arab 端点返回 400，不能靠主语言推成支持（Codex 在 #115 指出）', () => {
    // toBcp47('zlm') 特意给出 ms-Arab 求爪夷文；ms-Arab 实测 400，ms 才 200 且是拉丁文马来语，
    // 归一过去等于悄悄换了文字。通用的主语言回退会把它判成支持
    expect(supportsTarget('zlm')).toBe(false)
    // 四个实测通过的别名仍然成立
    for (const code of ['cmn', 'cmn-Hant', 'mon', 'srp']) {
      expect([code, supportsTarget(code)]).toEqual([code, true])
    }
  })

  it('不支持的目标语言在本地就失败，不去问端点（Codex 在 #115 指出）', async () => {
    // buildChain 会把不可用的首选留在链首，而 fallback.ts 挑步骤看的是降级记录、不是 isAvailable()，
    // 所以不本地拦的话第一批请求会真的发出去换回 400
    const fetch = vi.fn(async () => ok(['x']))
    const error = await provider(fetch, 'epo').translate(req(['one'], 'epo')).catch(e => e)
    expect((error as ProviderError).kind).toBe('bad-request')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('isAvailable() 就是这道闸：不支持的语言直接报不可用，链会自动跳过它', async () => {
    expect(await createMicrosoftProvider('cmn').isAvailable()).toBe(true)
    expect(await createMicrosoftProvider('epo').isAvailable()).toBe(false)
  })
})
