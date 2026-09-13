import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_MAX_ITEMS, createChromeBuiltinProvider, normalizeSpacing, type TranslatorApi, type TranslatorSession } from '@/providers/chrome-builtin'
import { ProviderError, type TranslateRequest } from '@/providers/types'

/** A fake Translator global: happy-dom has no such API; the behaviour follows the measurements of RESEARCH §6 */
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
  it('shape: the tags path, the built-in category, local batch parameters', () => {
    const { api } = fakeApi()
    const provider = createChromeBuiltinProvider('cmn', { translator: api })
    expect(provider.id).toBe('chrome-builtin')
    expect(provider.kind).toBe('builtin')
    expect(provider.wireFormats).toEqual(['tags']) // RESEARCH §6.2: measured to keep tags and placeholders
    expect(provider.rateLimit).toEqual({ rate: 20, capacity: 20 })
  })

  it('only available counts as usable: downloadable / downloading need a user gesture, which the chain cannot get', async () => {
    for (const [availability, expected] of [['available', true], ['downloadable', false], ['downloading', false], ['unavailable', false]] as const) {
      const { api } = fakeApi({ availability })
      expect(await createChromeBuiltinProvider('cmn', { translator: api }).isAvailable()).toBe(expected)
    }
  })

  it('without the API in the browser it is unavailable and does not throw', async () => {
    const provider = createChromeBuiltinProvider('cmn', { translator: null })
    expect(await provider.isAvailable()).toBe(false)
    await expect(provider.translate(req(['x']))).rejects.toMatchObject({ kind: 'no-key' })
  })

  it('when availability itself throws it is treated as unavailable, so the chain does not hang on this step', async () => {
    const api: TranslatorApi = { availability: async () => { throw new Error('boom') }, create: async () => ({ translate: async () => '' }) }
    expect(await createChromeBuiltinProvider('cmn', { translator: api }).isAvailable()).toBe(false)
  })

  it('the target language is converted from ISO 639-3 to BCP-47 for the API', async () => {
    const { api, state } = fakeApi()
    await createChromeBuiltinProvider('cmn-Hant', { translator: api }).translate(req(['x']))
    expect(state.lastCreate).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'zh-TW' })
  })

  it('a batch of several is translated one by one and put back by id', async () => {
    const { api, state } = fakeApi()
    const result = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['one', 'two', 'three']))
    expect(state.translated).toEqual(['one', 'two', 'three'])
    expect(result.segments).toEqual([{ id: 's0', text: '[one]' }, { id: 's1', text: '[two]' }, { id: 's2', text: '[three]' }])
    expect(result.provider).toBe('chrome-builtin')
  })

  it('an empty request creates no session', async () => {
    const { api, state } = fakeApi()
    expect((await createChromeBuiltinProvider('cmn', { translator: api }).translate(req([]))).segments).toEqual([])
    expect(state.creates).toBe(0)
  })

  it('sessions are reused per language pair: several batches create once (a second create still takes about 8.6 s of local loading)', async () => {
    const { api, state } = fakeApi()
    const provider = createChromeBuiltinProvider('cmn', { translator: api })
    await provider.translate(req(['a']))
    await provider.translate(req(['b']))
    await provider.translate(req(['c']))
    expect(state.creates).toBe(1)
  })

  it('after a failed create the cache is cleared and the next batch creates again', async () => {
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

  it('error classification: NotAllowedError / NotSupportedError → no-key, AbortError → aborted, the rest unknown', async () => {
    for (const [name, kind] of [['NotAllowedError', 'no-key'], ['NotSupportedError', 'no-key'], ['AbortError', 'aborted'], ['TypeError', 'unknown']] as const) {
      const { api } = fakeApi({ createError: named(name) })
      const error = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['x'])).catch(e => e)
      expect(error).toBeInstanceOf(ProviderError)
      expect(error.kind).toBe(kind)
    }
  })

  it('errors thrown while translating one by one are classified the same way', async () => {
    const { api } = fakeApi({ translate: () => { throw named('AbortError') } })
    await expect(createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['x']))).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('the signal goes to the per-segment translation only, not to session creation: one batch\'s timeout must not reject the shared session (Codex on #50)', async () => {
    const controller = new AbortController()
    const seen: [string, unknown][] = []
    const api: TranslatorApi = {
      availability: async () => 'available',
      create: async (opts) => { seen.push(['create', opts.signal]); return { translate: async (_i, o) => { seen.push(['translate', o?.signal]); return 'x' } } },
    }
    await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['a'], controller.signal))
    // create gets the provider's own signal (for the timeout abort), never any batch's request signal
    expect(seen[0]![0]).toBe('create')
    expect(seen[0]![1]).toBeInstanceOf(AbortSignal)
    expect(seen[0]![1]).not.toBe(controller.signal)
    expect(seen[1]).toEqual(['translate', controller.signal])
  })

  it('the semaphore hands the slot straight to a waiter: a call arriving the instant one is released cannot grab the same slot (Codex on #50)', async () => {
    const { createSemaphore } = await import('@/providers/chrome-builtin')
    const withPermit = createSemaphore(1)
    let active = 0
    let peak = 0
    const job = (release: Promise<void>) => withPermit(async () => { active++; peak = Math.max(peak, active); await release; active-- })
    let releaseA!: () => void
    const a = job(new Promise<void>(r => { releaseA = r }))
    const b = job(Promise.resolve()) // queued, waiting
    releaseA()
    // C arrives in the same turn A releases: an implementation that decrements first and wakes later lets B and C in together
    const c = job(Promise.resolve())
    await Promise.all([a, b, c])
    expect(peak).toBe(1)
  })

  it('a session-creation timeout really aborts the underlying load, not just the wrapping Promise (Codex on #50)', async () => {
    let seenSignal: AbortSignal | undefined
    const api: TranslatorApi = {
      availability: async () => 'available',
      create: (opts) => { seenSignal = opts.signal; return new Promise<TranslatorSession>(() => undefined) },
    }
    const provider = createChromeBuiltinProvider('cmn', { translator: api, createTimeoutMs: 20 })
    await expect(provider.translate(req(['x']))).rejects.toMatchObject({ kind: 'timeout' })
    expect(seenSignal?.aborted).toBe(true)
  })

  it('batches by its own declared cap: a large batch handed down the chain must not crush the local model in one go (Codex on #50)', async () => {
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
    // With google-web as the first choice a batch may hold 100 segments, and the fallback chain hands the same call over as it is
    const many = Array.from({ length: 100 }, (_, i) => `s${i}`)
    const result = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(many))
    expect(result.segments).toHaveLength(100)
    expect(result.segments[99]?.text).toBe('[s99]')
    expect(peak).toBeLessThanOrEqual(BUILTIN_MAX_ITEMS)
  })

  it('the concurrency gate is provider-level: with several batches arriving at once the total in flight still stays within the cap (Codex on #50)', async () => {
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
    // The queue may dispatch several batches at once; splitting inside one call only governs that call
    const provider = createChromeBuiltinProvider('cmn', { translator: api })
    const calls = Array.from({ length: 5 }, (_, b) =>
      provider.translate(req(Array.from({ length: 20 }, (_, i) => `b${b}s${i}`))))
    const results = await Promise.all(calls)
    expect(results.flatMap(r => r.segments)).toHaveLength(100)
    expect(results[4]?.segments[19]?.text).toBe('[b4s19]')
    expect(peak).toBeLessThanOrEqual(BUILTIN_MAX_ITEMS)
  })

  it('a session creation that hangs fails on its own timeout and clears the cache so the next one really re-creates (Codex on #50)', async () => {
    let creates = 0
    const api: TranslatorApi = {
      availability: async () => 'available',
      // The first never returns, the second is fine
      create: async () => {
        creates++
        if (creates === 1) return new Promise<TranslatorSession>(() => undefined)
        return { translate: async (input: string) => `[${input}]` }
      },
    }
    const provider = createChromeBuiltinProvider('cmn', { translator: api, createTimeoutMs: 20 })
    await expect(provider.translate(req(['x']))).rejects.toMatchObject({ kind: 'timeout' })
    // Without clearing the cache this would wait on the same dead Promise again
    const again = await provider.translate(req(['y']))
    expect(again.segments[0]?.text).toBe('[y]')
    expect(creates).toBe(2)
  })

  it('once the session is created the timeout no longer applies: the timer has to be cleared', async () => {
    const { api, state } = fakeApi()
    const provider = createChromeBuiltinProvider('cmn', { translator: api, createTimeoutMs: 20 })
    expect((await provider.translate(req(['a']))).segments[0]?.text).toBe('[a]')
    await new Promise(r => setTimeout(r, 40))
    expect((await provider.translate(req(['b']))).segments[0]?.text).toBe('[b]')
    expect(state.creates).toBe(1)
  })

  it('normalises the extra space after CJK punctuation (the “。 ” measured in RESEARCH §6.2)', () => {
    expect(normalizeSpacing('图连通时，定理 1 显然。 证明从略。')).toBe('图连通时，定理 1 显然。证明从略。')
    expect(normalizeSpacing('甲、 乙； 丙： 丁？ 戊！ 己')).toBe('甲、乙；丙：丁？戊！己')
    // The space after English punctuation must not move
    expect(normalizeSpacing('Let x = 1. Then y.')).toBe('Let x = 1. Then y.')
    // Placeholders pass through as they are
    expect(normalizeSpacing('见 <x id="1"/>。 又见 <t id="2">图</t>。')).toBe('见 <x id="1"/>。又见 <t id="2">图</t>。')
  })

  it('the translation is normalised before it is returned', async () => {
    const { api } = fakeApi({ translate: () => '第一句。 第二句。' })
    const result = await createChromeBuiltinProvider('cmn', { translator: api }).translate(req(['x']))
    expect(result.segments[0]?.text).toBe('第一句。第二句。')
  })

  it('takes Translator from the global by default', async () => {
    const { api } = fakeApi()
    vi.stubGlobal('Translator', api)
    try {
      expect(await createChromeBuiltinProvider('cmn').isAvailable()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
