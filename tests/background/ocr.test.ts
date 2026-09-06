import { describe, expect, it, vi } from 'vitest'
import { ocrCacheKey } from '@/cache/key'
import { HelperError, type HelperClient } from '@/entrypoints/background/helper'
import { createOcrService } from '@/entrypoints/background/ocr'
import type { OcrResult } from '@/shared/ocr'

// OCR 服务（DESIGN §15.2）：缓存按 imageHash | helper 版本；未命中才叫 helper；helper 不可用时如实回报

const RESULT: OcrResult = { width: 10, height: 20, lines: [{ text: 'Static charge', quad: [[0, 0], [1, 0], [1, 1], [0, 1]], conf: 1 }] }

function fakeHelper(overrides: Partial<HelperClient> = {}) {
  const ocr = vi.fn(async () => RESULT)
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
    const b = fakeHelper({ status: async () => ({ available: true, version: '0.2.0' }) })
    await createOcrService({ helper: b.helper, cache: cache.port }).ocr(call)
    expect(b.ocr).toHaveBeenCalledTimes(1)
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

  it('cancel 与 status 直通 helper', async () => {
    const cancel = vi.fn(() => 2)
    const { helper } = fakeHelper({ cancel })
    const service = createOcrService({ helper, cache: memoryCache().port })
    expect(service.cancel('s1')).toBe(2)
    expect(cancel).toHaveBeenCalledWith('s1')
    expect(await service.status()).toEqual({ available: true, version: '0.1.0' })
  })
})
