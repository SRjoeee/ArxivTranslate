import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_MAX_ITEMS, createChromeBuiltinProvider, normalizeSpacing, type TranslatorApi, type TranslatorSession } from '@/providers/chrome-builtin'
import { ProviderError, type TranslateRequest } from '@/providers/types'

/** Fake Translator global: happy-dom lacks this API; behavior follows measurements in RESEARCH §6 */
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
  it('declares markup support, built-in category, and local batching limits', () => {
    const { api } = fakeApi()
    const provider = createChromeBuiltinProvider('cmn', { translator: api })
    expect(provider.id).toBe('chrome-builtin')
    expect(provider.kind).toBe('builtin')
    expect(provider.preservesMarkup).toBe(true) // RESEARCH §6.2 verified that tags and placeholders are preserved.
    expect(provider.rateLimit).toEqual({ rate: 20, capacity: 20 })
  })

  it('only available is usable: downloadable and downloading require a user gesture unavailable to the chain', async () => {
    for (const [availability, expected] of [['available', true], ['downloadable', false], ['downloading', false], ['unavailable', false]] as const) {
      const { api } = fakeApi({ availability })
      expect(await createChromeBuiltinProvider('cmn', { translator: api }).isAvailable()).toBe(expected)
    }
  })

  it('a browser without the API reports unavailable without throwing', async () => {
    const provider = createChromeBuiltinProvider('cmn', { translator: null })
    expect(await provider.isAvailable()).toBe(false)
    await expect(provider.translate(req(['x']))).rejects.toMatchObject({ kind: 'no-key' })
  })

  it('availability errors report unavailable without breaking chain construction', async () => {
    const api: TranslatorApi = { availability: async () => { throw new Error('boom') }, create: async () => ({ translate: async () => '' }) }
    expect(await createChromeBuiltinProvider('cmn', { translator: api }).isAvailable()).toBe(false)
  })

  it('converts target language from ISO 639-3 to BCP-47 for the API', async () => {
    const { api, state } = fakeApi()
    await createChromeBuiltinProvider('cmn-Hant', { translator: api }).translate(req(['x']))
    expect(state.lastCreate).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'zh-TW' })
  })

  it('translates batch items individually and associates results by ID', async () => {
    const { api, state } = fakeApi()
    const result = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['one', 'two', 'three']))
    expect(state.translated).toEqual(['one', 'two', 'three'])
    expect(result.segments).toEqual([{ id: 's0', text: '[one]' }, { id: 's1', text: '[two]' }, { id: 's2', text: '[three]' }])
    expect(result.provider).toBe('chrome-builtin')
  })

  it('empty requests create no session', async () => {
    const { api, state } = fakeApi()
    expect((await createChromeBuiltinProvider('cmn', { translator: api }).translate(req([]))).segments).toEqual([])
    expect(state.creates).toBe(0)
  })

  it('reuses sessions by language pair across batches, avoiding another roughly 8.6-second local load', async () => {
    const { api, state } = fakeApi()
    const provider = createChromeBuiltinProvider('cmn', { translator: api })
    await provider.translate(req(['a']))
    await provider.translate(req(['b']))
    await provider.translate(req(['c']))
    expect(state.creates).toBe(1)
  })

  it('clears the cached session after create fails so the next batch recreates it', async () => {
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

  it('classifies NotAllowedError and NotSupportedError as no-key, AbortError as aborted, and other errors as unknown', async () => {
    for (const [name, kind] of [['NotAllowedError', 'no-key'], ['NotSupportedError', 'no-key'], ['AbortError', 'aborted'], ['TypeError', 'unknown']] as const) {
      const { api } = fakeApi({ createError: named(name) })
      const error = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['x'])).catch(e => e)
      expect(error).toBeInstanceOf(ProviderError)
      expect(error.kind).toBe(kind)
    }
  })

  it('classifies errors from individual translations the same way', async () => {
    const { api } = fakeApi({ translate: () => { throw named('AbortError') } })
    await expect(createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['x']))).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('passes the batch signal only to individual translations; one timeout must not reject the shared session creation (Codex #50)', async () => {
    const controller = new AbortController()
    const seen: [string, unknown][] = []
    const api: TranslatorApi = {
      availability: async () => 'available',
      create: async (opts) => { seen.push(['create', opts.signal]); return { translate: async (_i, o) => { seen.push(['translate', o?.signal]); return 'x' } } },
    }
    await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['a'], controller.signal))
    // create receives the provider-owned timeout signal, never a batch request signal.
    expect(seen[0]![0]).toBe('create')
    expect(seen[0]![1]).toBeInstanceOf(AbortSignal)
    expect(seen[0]![1]).not.toBe(controller.signal)
    expect(seen[1]).toEqual(['translate', controller.signal])
  })

  it('the semaphore transfers permits directly to waiters so new calls cannot steal a released permit (Codex #50)', async () => {
    const { createSemaphore } = await import('@/providers/chrome-builtin')
    const withPermit = createSemaphore(1)
    let active = 0
    let peak = 0
    const job = (release: Promise<void>) => withPermit(async () => { active++; peak = Math.max(peak, active); await release; active-- })
    let releaseA!: () => void
    const a = job(new Promise<void>(r => { releaseA = r }))
    const b = job(Promise.resolve()) // Queued and waiting
    releaseA()
    // C arrives in the same turn that A releases; decrementing before waking would let both B and C enter.
    const c = job(Promise.resolve())
    await Promise.all([a, b, c])
    expect(peak).toBe(1)
  })

  it('session creation timeout aborts underlying loading rather than only rejecting the wrapper promise (Codex #50)', async () => {
    let seenSignal: AbortSignal | undefined
    const api: TranslatorApi = {
      availability: async () => 'available',
      create: (opts) => { seenSignal = opts.signal; return new Promise<TranslatorSession>(() => undefined) },
    }
    const provider = createChromeBuiltinProvider('cmn', { translator: api, createTimeoutMs: 20 })
    await expect(provider.translate(req(['x']))).rejects.toMatchObject({ kind: 'timeout' })
    expect(seenSignal?.aborted).toBe(true)
  })

  it('splits requests by declared limits so large fallback batches cannot overwhelm the local model (Codex #50)', async () => {
    let peak = 0
    let running = 0
    const api: TranslatorApi = {
      availability: async () => 'available',
      create: async () => ({
        translate: async (input: string) => {
          running++
          peak = Math.max(peak, running)
          await new Promise(r => setTimeout(r, 1))
          running--
          return `[${input}]`
        },
      }),
    }
    // Preferred google-web batches can contain 100 segments, and fallback forwards the same call unchanged.
    const many = Array.from({ length: 100 }, (_, i) => `s${i}`)
    const result = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(many))
    expect(result.segments).toHaveLength(100)
    expect(result.segments[99]?.text).toBe('[s99]')
    expect(peak).toBeLessThanOrEqual(BUILTIN_MAX_ITEMS)
  })

  it('provider-wide concurrency limits total in-flight work across simultaneous batches (Codex #50)', async () => {
    let running = 0
    let peak = 0
    const api: TranslatorApi = {
      availability: async () => 'available',
      create: async () => ({
        translate: async (input: string) => {
          running++
          peak = Math.max(peak, running)
          await new Promise(r => setTimeout(r, 1))
          running--
          return `[${input}]`
        },
      }),
    }
    // The queue may dispatch several batches together; per-call splitting limits only one call.
    const provider = createChromeBuiltinProvider('cmn', { translator: api })
    const calls = Array.from({ length: 5 }, (_, b) =>
      provider.translate(req(Array.from({ length: 20 }, (_, i) => `b${b}s${i}`))))
    const results = await Promise.all(calls)
    expect(results.flatMap(r => r.segments)).toHaveLength(100)
    expect(results[4]?.segments[19]?.text).toBe('[b4s19]')
    expect(peak).toBeLessThanOrEqual(BUILTIN_MAX_ITEMS)
  })

  it('hung session creation fails on its own timeout and clears the cache so the next call really recreates it (Codex #50)', async () => {
    let creates = 0
    const api: TranslatorApi = {
      availability: async () => 'available',
      // The first call never returns; the second succeeds.
      create: async () => {
        creates++
        if (creates === 1) return new Promise<TranslatorSession>(() => undefined)
        return { translate: async (input: string) => `[${input}]` }
      },
    }
    const provider = createChromeBuiltinProvider('cmn', { translator: api, createTimeoutMs: 20 })
    await expect(provider.translate(req(['x']))).rejects.toMatchObject({ kind: 'timeout' })
    // Without cache cleanup this would wait on the same hung promise again.
    const again = await provider.translate(req(['y']))
    expect(again.segments[0]?.text).toBe('[y]')
    expect(creates).toBe(2)
  })

  it('successful session creation clears its timer and cannot later time out', async () => {
    const { api, state } = fakeApi()
    const provider = createChromeBuiltinProvider('cmn', { translator: api, createTimeoutMs: 20 })
    expect((await provider.translate(req(['a']))).segments[0]?.text).toBe('[a]')
    await new Promise(r => setTimeout(r, 40))
    expect((await provider.translate(req(['b']))).segments[0]?.text).toBe('[b]')
    expect(state.creates).toBe(1)
  })

  it('normalizes extra spaces after CJK punctuation (RESEARCH §6.2 observed a space after a full stop)', () => {
    expect(normalizeSpacing('图连通时，定理 1 显然。 证明从略。')).toBe('图连通时，定理 1 显然。证明从略。')
    expect(normalizeSpacing('甲、 乙； 丙： 丁？ 戊！ 己')).toBe('甲、乙；丙：丁？戊！己')
    // Preserve spaces after English punctuation.
    expect(normalizeSpacing('Let x = 1. Then y.')).toBe('Let x = 1. Then y.')
    // Pass placeholders through unchanged.
    expect(normalizeSpacing('见 <x id="1"/>。 又见 <t id="2">图</t>。')).toBe('见 <x id="1"/>。又见 <t id="2">图</t>。')
  })

  it('returns normalized translations', async () => {
    const { api } = fakeApi({ translate: () => '第一句。 第二句。' })
    const result = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['x']))
    expect(result.segments[0]?.text).toBe('第一句。第二句。')
  })

  it('uses the global Translator by default', async () => {
    const { api } = fakeApi()
    vi.stubGlobal('Translator', api)
    try {
      expect(await createChromeBuiltinProvider('cmn').isAvailable()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
