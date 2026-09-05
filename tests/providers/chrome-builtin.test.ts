import { describe, expect, it, vi } from 'vitest'
import { createChromeBuiltinProvider, normalizeSpacing, type TranslatorApi, type TranslatorSession } from '@/providers/chrome-builtin'
import { ProviderError, type TranslateRequest } from '@/providers/types'

/** 假的 Translator 全局：happy-dom 里没有这个 API，行为照 RESEARCH §6 的实测 */
function fakeApi(options: {
  availability?: string
  translate?: (input: string) => Promise<string> | string
  createError?: Error
} = {}) {
  const state = { creates: 0, translated: [] as string[], lastCreate: null as unknown }
  const api: TranslatorApi = {
    availability: async () => options.availability ?? 'available',
    create: async (opts) => {
      state.creates++
      state.lastCreate = opts
      if (options.createError) throw options.createError
      const session: TranslatorSession = {
        translate: async (input) => {
          state.translated.push(input)
          return options.translate ? await options.translate(input) : `[${input}]`
        },
      }
      return session
    },
  }
  return { api, state }
}

const req = (texts: string[], signal?: AbortSignal): TranslateRequest => ({
  segments: texts.map((text, i) => ({ id: `s${i}`, text })),
  source: 'en',
  target: 'cmn',
  ...(signal ? { signal } : {}),
})

const named = (name: string, message = name) => Object.assign(new Error(message), { name })

describe('createChromeBuiltinProvider', () => {
  it('形状：markup 路径、内置类别、本地批次参数', () => {
    const { api } = fakeApi()
    const provider = createChromeBuiltinProvider('cmn', { translator: api })
    expect(provider.id).toBe('chrome-builtin')
    expect(provider.kind).toBe('builtin')
    expect(provider.preservesMarkup).toBe(true) // RESEARCH §6.2 实测保留标签与占位符
    expect(provider.rateLimit).toEqual({ rate: 20, capacity: 20 })
  })

  it('只有 available 才算可用：downloadable / downloading 需要用户手势，链上拿不到', async () => {
    for (const [availability, expected] of [['available', true], ['downloadable', false], ['downloading', false], ['unavailable', false]] as const) {
      const { api } = fakeApi({ availability })
      expect(await createChromeBuiltinProvider('cmn', { translator: api }).isAvailable()).toBe(expected)
    }
  })

  it('浏览器没有这个 API 时不可用，也不会抛', async () => {
    const provider = createChromeBuiltinProvider('cmn', { translator: null })
    expect(await provider.isAvailable()).toBe(false)
    await expect(provider.translate(req(['x']))).rejects.toMatchObject({ kind: 'no-key' })
  })

  it('availability 自己抛错时按不可用处理，不让链挂在这一步', async () => {
    const api: TranslatorApi = { availability: async () => { throw new Error('boom') }, create: async () => ({ translate: async () => '' }) }
    expect(await createChromeBuiltinProvider('cmn', { translator: api }).isAvailable()).toBe(false)
  })

  it('目标语言从 ISO 639-3 转成 BCP-47 交给 API', async () => {
    const { api, state } = fakeApi()
    await createChromeBuiltinProvider('cmn-Hant', { translator: api }).translate(req(['x']))
    expect(state.lastCreate).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'zh-TW' })
  })

  it('一批多条逐条翻译，按 id 归位', async () => {
    const { api, state } = fakeApi()
    const result = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['one', 'two', 'three']))
    expect(state.translated).toEqual(['one', 'two', 'three'])
    expect(result.segments).toEqual([{ id: 's0', text: '[one]' }, { id: 's1', text: '[two]' }, { id: 's2', text: '[three]' }])
    expect(result.provider).toBe('chrome-builtin')
  })

  it('空请求不建会话', async () => {
    const { api, state } = fakeApi()
    expect((await createChromeBuiltinProvider('cmn', { translator: api }).translate(req([]))).segments).toEqual([])
    expect(state.creates).toBe(0)
  })

  it('会话按语言对复用：多批只 create 一次（二次 create 仍要约 8.6 s 本地加载）', async () => {
    const { api, state } = fakeApi()
    const provider = createChromeBuiltinProvider('cmn', { translator: api })
    await provider.translate(req(['a']))
    await provider.translate(req(['b']))
    await provider.translate(req(['c']))
    expect(state.creates).toBe(1)
  })

  it('create 失败后清掉缓存，下一批重新创建', async () => {
    let fail = true
    const state = { creates: 0 }
    const api: TranslatorApi = {
      availability: async () => 'available',
      create: async () => {
        state.creates++
        if (fail) throw named('NotAllowedError', 'Requires a user gesture')
        return { translate: async (input: string) => `[${input}]` }
      },
    }
    const provider = createChromeBuiltinProvider('cmn', { translator: api })
    await expect(provider.translate(req(['a']))).rejects.toMatchObject({ kind: 'no-key' })
    fail = false
    expect((await provider.translate(req(['b']))).segments[0]?.text).toBe('[b]')
    expect(state.creates).toBe(2)
  })

  it('错误分类：NotAllowedError / NotSupportedError → no-key，AbortError → aborted，其余 unknown', async () => {
    for (const [name, kind] of [['NotAllowedError', 'no-key'], ['NotSupportedError', 'no-key'], ['AbortError', 'aborted'], ['TypeError', 'unknown']] as const) {
      const { api } = fakeApi({ createError: named(name) })
      const error = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['x'])).catch(e => e)
      expect(error).toBeInstanceOf(ProviderError)
      expect(error.kind).toBe(kind)
    }
  })

  it('逐条翻译时抛的错同样分类', async () => {
    const { api } = fakeApi({ translate: () => { throw named('AbortError') } })
    await expect(createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['x']))).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('signal 透传给会话与逐条翻译', async () => {
    const controller = new AbortController()
    const seen: unknown[] = []
    const api: TranslatorApi = {
      availability: async () => 'available',
      create: async (opts) => { seen.push(opts.signal); return { translate: async (_i, o) => { seen.push(o?.signal); return 'x' } } },
    }
    await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['a'], controller.signal))
    expect(seen).toEqual([controller.signal, controller.signal])
  })

  it('归一化中日韩标点后的多余空格（RESEARCH §6.2 实测的「。 」）', () => {
    expect(normalizeSpacing('图连通时，定理 1 显然。 证明从略。')).toBe('图连通时，定理 1 显然。证明从略。')
    expect(normalizeSpacing('甲、 乙； 丙： 丁？ 戊！ 己')).toBe('甲、乙；丙：丁？戊！己')
    // 英文标点后的空格不能动
    expect(normalizeSpacing('Let x = 1. Then y.')).toBe('Let x = 1. Then y.')
    // 占位符原样穿过
    expect(normalizeSpacing('见 <x id="1"/>。 又见 <t id="2">图</t>。')).toBe('见 <x id="1"/>。又见 <t id="2">图</t>。')
  })

  it('译文经过归一化再返回', async () => {
    const { api } = fakeApi({ translate: () => '第一句。 第二句。' })
    const result = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['x']))
    expect(result.segments[0]?.text).toBe('第一句。第二句。')
  })

  it('默认从全局取 Translator', async () => {
    const { api } = fakeApi()
    vi.stubGlobal('Translator', api)
    try {
      expect(await createChromeBuiltinProvider('cmn').isAvailable()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
