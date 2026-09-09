import { afterEach, describe, expect, it, vi } from 'vitest'
import { ocrCacheKey } from '@/cache/key'
import { HelperError, type HelperClient } from '@/entrypoints/background/helper'
import { createOcrService } from '@/entrypoints/background/ocr'
import type { OcrResult } from '@/shared/ocr'

// OCR service (DESIGN §15.2): cache by imageHash and helper version; call the helper only on misses and report unavailability accurately.

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

  it('cache miss: calls the helper and caches the result; a second request for the same imageHash hits without another helper call', async () => {
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

  it('a new helper version changes the key and runs OCR again', async () => {
    const cache = memoryCache()
    const a = fakeHelper()
    await createOcrService({ helper: a.helper, cache: cache.port }).ocr(call)
    const ocrB = vi.fn(async () => ({ result: RESULT, version: '0.2.0' }))
    const b = fakeHelper({ status: async () => ({ available: true, version: '0.2.0' }), ocr: ocrB })
    await createOcrService({ helper: b.helper, cache: cache.port }).ocr(call)
    expect(ocrB).toHaveBeenCalledTimes(1)
    expect(cache.store.size).toBe(2)
  })

  it('treats a cache collision with an unexpected value shape as a miss', async () => {
    const { helper, ocr } = fakeHelper()
    const cache = memoryCache()
    cache.store.set(await ocrCacheKey('h1', '0.1.0'), 'translation instead of an OCR result')
    const service = createOcrService({ helper, cache: cache.port })
    expect((await service.ocr(call)).ok).toBe(true)
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('an unavailable helper skips cache lookup and OCR, returning a network error with the reason', async () => {
    const { helper, ocr } = fakeHelper({ status: async () => ({ available: false, reason: 'Helper not installed' }) })
    const cache = memoryCache()
    const getMany = vi.spyOn(cache.port, 'getMany')
    const result = await createOcrService({ helper, cache: cache.port }).ocr(call)
    expect(result).toEqual({ ok: false, error: { kind: 'network', message: 'Helper not installed' } })
    expect(ocr).not.toHaveBeenCalled()
    expect(getMany).not.toHaveBeenCalled()
  })

  it('preserves HelperError.kind and does not cache failed OCR', async () => {
    const { helper } = fakeHelper({ ocr: async () => { throw new HelperError('aborted', 'Session cancelled') } })
    const cache = memoryCache()
    const result = await createOcrService({ helper, cache: cache.port }).ocr(call)
    expect(result).toEqual({ ok: false, error: { kind: 'aborted', message: 'Session cancelled' } })
    expect(cache.store.size).toBe(0)
  })

  it('calls for cancelled scopes return aborted without OCR, including cancellation during cache lookup (observed on device)', async () => {
    const { helper, ocr } = fakeHelper()
    const cache = memoryCache()
    const service = createOcrService({ helper, cache: cache.port })
    service.cancel('s1')
    expect(await service.ocr(call)).toEqual({ ok: false, error: { kind: 'aborted', message: 'Session cancelled' } })
    expect(ocr).not.toHaveBeenCalled()
    // Cancel during cache lookup: wait for getMany after status and key hashing, hold it, cancel, then release.
    const original = cache.port.getMany
    let release: () => void = () => {}
    const reached = new Promise<void>(signal => {
      cache.port.getMany = () => new Promise(resolve => { release = () => resolve([null]); signal() })
    })
    const pending = service.ocr({ ...call, scope: 's2' })
    await reached
    service.cancel('s2')
    release()
    expect(await pending).toEqual({ ok: false, error: { kind: 'aborted', message: 'Session cancelled' } })
    expect(ocr).not.toHaveBeenCalled()
    // Other scopes are unaffected.
    cache.port.getMany = original
    expect((await service.ocr({ ...call, scope: 's3' })).ok).toBe(true)
  })

  it('cache reads have a budget: a stalled IndexedDB read becomes a miss and OCR continues (Codex #87)', async () => {
    vi.useFakeTimers()
    const { helper, ocr } = fakeHelper()
    const cache = memoryCache()
    // Wait for getMany: key hashing is genuinely asynchronous and unaffected by fake timers; the budget timer starts in the same expression.
    let reached: () => void = () => {}
    const reachedP = new Promise<void>(resolve => { reached = resolve })
    cache.port.getMany = () => { reached(); return new Promise(() => {}) } // Never resolves
    const service = createOcrService({ helper, cache: cache.port, cacheReadBudgetMs: 500 })
    const pending = service.ocr(call)
    await reachedP
    await vi.advanceTimersByTimeAsync(499)
    expect(ocr).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect((await pending).ok).toBe(true)
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('if the connection version changes during cache lookup after reconnecting, caches under the reply connection version (Codex #87)', async () => {
    const { helper } = fakeHelper({ ocr: async () => ({ result: RESULT, version: '0.2.0' }) })
    const cache = memoryCache()
    await createOcrService({ helper, cache: cache.port }).ocr(call)
    expect(cache.store.has(await ocrCacheKey('h1', '0.2.0'))).toBe(true)
    expect(cache.store.has(await ocrCacheKey('h1', '0.1.0'))).toBe(false)
  })

  it('cancellation during cache lookup returns aborted even on a hit (Codex #87)', async () => {
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
    expect(await pending).toEqual({ ok: false, error: { kind: 'aborted', message: 'Session cancelled' } })
    expect(ocr).not.toHaveBeenCalled()
  })

  it('cache writes do not block replies: a stalled putMany still returns OCR results (Codex #87)', async () => {
    const { helper } = fakeHelper()
    const cache = memoryCache()
    cache.port.putMany = () => new Promise(() => {})
    const result = await createOcrService({ helper, cache: cache.port }).ocr(call)
    expect(result).toEqual({ ok: true, result: RESULT, cached: false })
  })

  it('forwards cancel and status to the helper', async () => {
    const cancel = vi.fn(() => 2)
    const { helper } = fakeHelper({ cancel })
    const service = createOcrService({ helper, cache: memoryCache().port })
    expect(service.cancel('s1')).toBe(2)
    expect(cancel).toHaveBeenCalledWith('s1')
    expect(await service.status()).toEqual({ available: true, version: '0.1.0' })
  })
})
