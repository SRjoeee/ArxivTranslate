import { afterEach, describe, expect, it, vi } from 'vitest'
import { ocrCacheKey } from '@/cache/key'
import { HelperError, type HelperClient } from '@/entrypoints/background/helper'
import { createOcrService } from '@/entrypoints/background/ocr'
import type { OcrResult } from '@/shared/ocr'

// OCR 服务（DESIGN §15.2）：缓存按 imageHash | helper 版本；未命中才叫 helper；helper 不可用时如实回报

const RESULT: OcrResult = { width: 10, height: 20, lines: [{ text: 'Static charge', quad: [[0, 0], [1, 0], [1, 1], [0, 1]], conf: 1 }] }

function fakeHelper(overrides: Partial<HelperClient> = {}) {
  const ocr = vi.fn(async () => ({ result: RESULT, version: '0.1.0' }))
  const helper: HelperClient = {
    status: async () => ({ available: true, version: '0.1.0' }),
    ocr,
    cancel: () => 0,
    ...overrides,
  }
  return { helper, ocr }
}

function memoryCache() {
  const store = new Map<string, string>()
  return {
    store,
    port: {
      getMany: async (keys: string[]) => keys.map(k => store.get(k) ?? null),
      putMany: async (entries: { key: string; translation: string; paper: string }[]) => { for (const e of entries) store.set(e.key, e.translation) },
    },
  }
}

const call = { imageHash: 'h1', image: 'AAAA', mime: 'image/png', paper: '2507.00150', scope: 's1' }

describe('createOcrService', () => {
  afterEach(() => { vi.useRealTimers() })

  it('未命中：叫 helper、写回缓存；同一 imageHash 第二次直接命中，不再叫 helper', async () => {
    const { helper, ocr } = fakeHelper()
    const cache = memoryCache()
    const service = createOcrService({ helper, cache: cache.port })
    const first = await service.ocr(call)
    expect(first).toEqual({ ok: true, result: RESULT, cached: false })
    expect(ocr).toHaveBeenCalledTimes(1)
    expect(ocr).toHaveBeenCalledWith({ image: 'AAAA' }, 's1')
    expect(cache.store.get(await ocrCacheKey('h1', '0.1.0'))).toBe(JSON.stringify(RESULT))
    const second = await service.ocr(call)
    expect(second).toEqual({ ok: true, result: RESULT, cached: true })
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('helper 换了版本：键不同，重新识别', async () => {
    const cache = memoryCache()
    const a = fakeHelper()
    await createOcrService({ helper: a.helper, cache: cache.port }).ocr(call)
    const ocrB = vi.fn(async () => ({ result: RESULT, version: '0.2.0' }))
    const b = fakeHelper({ status: async () => ({ available: true, version: '0.2.0' }), ocr: ocrB })
    await createOcrService({ helper: b.helper, cache: cache.port }).ocr(call)
    expect(ocrB).toHaveBeenCalledTimes(1)
    expect(cache.store.size).toBe(2)
  })

  it('缓存里撞键的东西不是我们的形状：当未命中', async () => {
    const { helper, ocr } = fakeHelper()
    const cache = memoryCache()
    cache.store.set(await ocrCacheKey('h1', '0.1.0'), '译文而不是 OCR 结果')
    const service = createOcrService({ helper, cache: cache.port })
    expect((await service.ocr(call)).ok).toBe(true)
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('helper 不可用：不查缓存、不叫 helper，回 network 错误带原因', async () => {
    const { helper, ocr } = fakeHelper({ status: async () => ({ available: false, reason: 'helper 未安装' }) })
    const cache = memoryCache()
    const getMany = vi.spyOn(cache.port, 'getMany')
    const result = await createOcrService({ helper, cache: cache.port }).ocr(call)
    expect(result).toEqual({ ok: false, error: { kind: 'network', message: 'helper 未安装' } })
    expect(ocr).not.toHaveBeenCalled()
    expect(getMany).not.toHaveBeenCalled()
  })

  it('helper 出错：HelperError 的 kind 原样带回，不写缓存', async () => {
    const { helper } = fakeHelper({ ocr: async () => { throw new HelperError('aborted', '会话已撤销') } })
    const cache = memoryCache()
    const result = await createOcrService({ helper, cache: cache.port }).ocr(call)
    expect(result).toEqual({ ok: false, error: { kind: 'aborted', message: '会话已撤销' } })
    expect(cache.store.size).toBe(0)
  })

  it('撤过的 scope 之后的调用直接回 aborted，不叫 helper；读缓存期间被撤也不叫（真机实测的空窗）', async () => {
    const { helper, ocr } = fakeHelper()
    const cache = memoryCache()
    const service = createOcrService({ helper, cache: cache.port })
    service.cancel('s1')
    expect(await service.ocr(call)).toEqual({ ok: false, error: { kind: 'aborted', message: '会话已撤销' } })
    expect(ocr).not.toHaveBeenCalled()
    // 读缓存时才撤：等服务真的进到 getMany（前面还有 status 与算键两个 await），挂住它，撤，再放行
    const original = cache.port.getMany
    let release: () => void = () => {}
    const reached = new Promise<void>(signal => {
      cache.port.getMany = () => new Promise(resolve => { release = () => resolve([null]); signal() })
    })
    const pending = service.ocr({ ...call, scope: 's2' })
    await reached
    service.cancel('s2')
    release()
    expect(await pending).toEqual({ ok: false, error: { kind: 'aborted', message: '会话已撤销' } })
    expect(ocr).not.toHaveBeenCalled()
    // 别的 scope 不受影响
    cache.port.getMany = original
    expect((await service.ocr({ ...call, scope: 's3' })).ok).toBe(true)
  })

  it('读缓存有预算：IndexedDB 挂住不返回时超预算当未命中，识别照常进行（Codex 在 #87 指出）', async () => {
    vi.useFakeTimers()
    const { helper, ocr } = fakeHelper()
    const cache = memoryCache()
    // 等服务真的进到 getMany（前面的算键是真实的异步，假时钟推不动它），预算计时器在同一表达式里注册
    let reached: () => void = () => {}
    const reachedP = new Promise<void>(resolve => { reached = resolve })
    cache.port.getMany = () => { reached(); return new Promise(() => {}) } // 永远不返回
    const service = createOcrService({ helper, cache: cache.port, cacheReadBudgetMs: 500 })
    const pending = service.ocr(call)
    await reachedP
    await vi.advanceTimersByTimeAsync(499)
    expect(ocr).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect((await pending).ok).toBe(true)
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('回应所在连接的版本与查缓存时的不同（读缓存期间重连、helper 换了版本）：按新版本落缓存（Codex 在 #87 指出）', async () => {
    const { helper } = fakeHelper({ ocr: async () => ({ result: RESULT, version: '0.2.0' }) })
    const cache = memoryCache()
    await createOcrService({ helper, cache: cache.port }).ocr(call)
    expect(cache.store.has(await ocrCacheKey('h1', '0.2.0'))).toBe(true)
    expect(cache.store.has(await ocrCacheKey('h1', '0.1.0'))).toBe(false)
  })

  it('读缓存期间被撤：命中也回 aborted（Codex 在 #87 指出）', async () => {
    const { helper, ocr } = fakeHelper()
    const cache = memoryCache()
    cache.store.set(await ocrCacheKey('h1', '0.1.0'), JSON.stringify(RESULT))
    const service = createOcrService({ helper, cache: cache.port })
    const original = cache.port.getMany
    let release: () => void = () => {}
    const reached = new Promise<void>(signal => {
      cache.port.getMany = keys => new Promise(resolve => { release = () => resolve(original(keys)); signal() })
    })
    const pending = service.ocr({ ...call, scope: 's9' })
    await reached
    service.cancel('s9')
    release()
    expect(await pending).toEqual({ ok: false, error: { kind: 'aborted', message: '会话已撤销' } })
    expect(ocr).not.toHaveBeenCalled()
  })

  it('写缓存不阻塞回应：putMany 挂住时识别结果照样回去（Codex 在 #87 指出）', async () => {
    const { helper } = fakeHelper()
    const cache = memoryCache()
    cache.port.putMany = () => new Promise(() => {})
    const result = await createOcrService({ helper, cache: cache.port }).ocr(call)
    expect(result).toEqual({ ok: true, result: RESULT, cached: false })
  })

  it('cancel 与 status 直通 helper', async () => {
    const cancel = vi.fn(() => 2)
    const { helper } = fakeHelper({ cancel })
    const service = createOcrService({ helper, cache: memoryCache().port })
    expect(service.cancel('s1')).toBe(2)
    expect(cancel).toHaveBeenCalledWith('s1')
    expect(await service.status()).toEqual({ available: true, version: '0.1.0' })
  })
})
