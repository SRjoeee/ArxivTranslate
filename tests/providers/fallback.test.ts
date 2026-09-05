import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_COOLDOWN_MS, createFallbackService, type FallbackStep } from '@/providers/fallback'
import type { TranslateCall, TranslateMessageResponse } from '@/providers/translate-service'
import type { ProviderErrorKind, TranslationProvider } from '@/providers/types'

const provider = (id: string): TranslationProvider => ({
  id,
  displayName: id.toUpperCase(),
  kind: 'llm',
  preservesMarkup: true,
  maxBatchChars: 1000,
  maxBatchItems: 4,
  isAvailable: async () => true,
  translate: async () => ({ segments: [], provider: id }),
})

const ok = (id: string): TranslateMessageResponse => ({ ok: true, result: { segments: [{ id: 's1', text: `${id} 译文` }], provider: id }, cached: 0 })
const fail = (kind: ProviderErrorKind, message: string = kind): TranslateMessageResponse => ({ ok: false, error: { kind, message } })

/** 每次调用依次返回预设的结果；用完后重复最后一个 */
function step(id: string, responses: TranslateMessageResponse[]): FallbackStep & { calls: number; cancelled: string[] } {
  const state = { calls: 0, cancelled: [] as string[] }
  return {
    provider: provider(id),
    service: {
      translate: async (_call: TranslateCall) => responses[Math.min(state.calls++, responses.length - 1)]!,
      cancel: (scope: string) => { state.cancelled.push(scope); return 1 },
    },
    get calls() { return state.calls },
    get cancelled() { return state.cancelled },
  } as FallbackStep & { calls: number; cancelled: string[] }
}

const call = { request: { segments: [{ id: 's1', text: 'Text.' }], source: 'en', target: 'cmn' } } as unknown as TranslateCall

describe('createFallbackService', () => {
  it('首选成功时不碰后面的引擎', async () => {
    const first = step('llm', [ok('llm')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    expect(res.ok && res.result.provider).toBe('llm')
    expect(second.calls).toBe(0)
    expect(service.status()).toEqual({ configuredId: 'llm', activeId: 'llm' })
  })

  it('auth 是配置问题：切到下一个引擎，本会话内不再试首选', async () => {
    const first = step('llm', [fail('auth', 'User not found.')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])

    const res = await service.translate(call)
    expect(res.ok && res.result.provider).toBe('google-web')
    expect(service.status()).toEqual({
      configuredId: 'llm',
      activeId: 'google-web',
      demoted: { id: 'llm', displayName: 'LLM', kind: 'auth', message: 'User not found.' },
    })

    // 第二次调用直接走降级引擎，不再浪费一次请求
    await service.translate(call)
    expect(first.calls).toBe(1)
    expect(second.calls).toBe(2)
  })

  it('瞬时错误冷却到期后回到首选，成功即清空降级记录', async () => {
    let clock = 0
    const first = step('llm', [fail('network', '连接被重置'), ok('llm')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second], { cooldownMs: 1000, now: () => clock })

    expect((await service.translate(call)).ok).toBe(true)
    expect(service.status().activeId).toBe('google-web')

    clock = 999
    await service.translate(call)
    expect(first.calls).toBe(1) // 还在冷却里

    clock = 1000
    const back = await service.translate(call)
    expect(back.ok && back.result.provider).toBe('llm')
    expect(service.status().activeId).toBe('llm')
    // 成功清空记录：demoted 只留作最近一次原因的展示
    expect(service.status().demoted?.kind).toBe('network')
  })

  it('aborted 不降级也不换引擎：会话取消不是引擎的错', async () => {
    const first = step('llm', [fail('aborted', '已取消（scope: s1）')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    expect(res.ok).toBe(false)
    expect(second.calls).toBe(0)
    expect(service.status().activeId).toBe('llm')
  })

  it('链上最后一个引擎失败时如实上报，run.ts 据此停下', async () => {
    const first = step('llm', [fail('auth')])
    const second = step('google-web', [fail('network')])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    expect(res).toEqual(fail('network'))
  })

  it('全部降级后退回最后一个引擎，而不是无引擎可用', async () => {
    const first = step('llm', [fail('auth')])
    const second = step('google-web', [fail('auth'), ok('google-web')])
    const service = createFallbackService([first, second])
    await service.translate(call) // 两个都 auth，都被记账（最后一个是如实上报，不记）
    const res = await service.translate(call)
    expect(res.ok && res.result.provider).toBe('google-web')
  })

  it('cancel 扇出到每套队列：漏一个就有在飞请求回来往 DOM 写', () => {
    const first = step('llm', [ok('llm')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    expect(service.cancel('session-1')).toBe(2)
    expect(first.cancelled).toEqual(['session-1'])
    expect(second.cancelled).toEqual(['session-1'])
  })

  it('只有一个引擎时原样返回错误，不吞不改', async () => {
    const only = step('llm', [fail('auth', 'bad key')])
    const service = createFallbackService([only])
    expect(await service.translate(call)).toEqual(fail('auth', 'bad key'))
    expect(service.status()).toEqual({ configuredId: 'llm', activeId: 'llm' })
  })

  it('空链是编程错误，直接抛', () => {
    expect(() => createFallbackService([])).toThrow()
  })

  it('默认冷却 60 秒', () => {
    expect(DEFAULT_COOLDOWN_MS).toBe(60_000)
  })

  it('降级写一条警告日志，便于用户与 e2e 定位', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = createFallbackService([step('llm', [fail('auth', 'bad key')]), step('google-web', [ok('google-web')])])
    await service.translate(call)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('降级'))
    warn.mockRestore()
  })
})
