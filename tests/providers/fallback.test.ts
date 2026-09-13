import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_COOLDOWN_MS, createFallbackService, type FallbackStep } from '@/providers/fallback'
import type { TranslateCall, TranslateMessageResponse } from '@/providers/translate-service'
import type { ProviderErrorKind, TranslationProvider } from '@/providers/types'

const provider = (id: string): TranslationProvider => ({
  id,
  displayName: id.toUpperCase(),
  kind: 'llm',
  wireFormats: ['tags'] as const,
  maxBatchChars: 1000,
  maxBatchItems: 4,
  isAvailable: async () => true,
  translate: async () => ({ segments: [], provider: id }),
})

const ok = (id: string): TranslateMessageResponse => ({ ok: true, result: { segments: [{ id: 's1', text: `${id} 译文` }], provider: id }, cached: 0 })
const fail = (kind: ProviderErrorKind, message: string = kind): TranslateMessageResponse => ({ ok: false, error: { kind, message, isolatable: true } })

/** Returns the preset results one per call; once used up, repeats the last */
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
const partialFail = (kind: ProviderErrorKind, ids: string[]): TranslateMessageResponse =>
  ({ ok: false, error: { kind, message: kind, isolatable: true }, partial: ids.map(id => ({ id, text: `${id} 译文` })) })

describe('createFallbackService', () => {
  it('when the first choice succeeds the engines behind it are not touched', async () => {
    const first = step('llm', [ok('llm')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    expect(res.ok && res.result.provider).toBe('llm')
    expect(second.calls).toBe(0)
    expect(service.status()).toEqual({ configuredId: 'llm', activeId: 'llm', demotions: [] })
  })

  it('auth is a configuration problem: switch to the next engine, and do not try the first choice again in this session', async () => {
    const first = step('llm', [fail('auth', 'User not found.')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])

    const res = await service.translate(call)
    expect(res.ok && res.result.provider).toBe('google-web')
    const demoted = { id: 'llm', displayName: 'LLM', kind: 'auth' as const, message: 'User not found.' }
    expect(service.status()).toEqual({
      configuredId: 'llm',
      activeId: 'google-web',
      demoted,
      // Every hand-over still in force, so a caller can ask about **its own** engine rather than
      // about the most recent one (Codex on #157)
      demotions: [demoted],
    })

    // The second call goes straight to the fallback engine, wasting no request
    await service.translate(call)
    expect(first.calls).toBe(1)
    expect(second.calls).toBe(2)
  })

  it('after a transient error\'s cooldown it returns to the first choice, and success clears the demotion record', async () => {
    let clock = 0
    const first = step('llm', [fail('network', 'connection reset'), ok('llm')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second], { cooldownMs: 1000, now: () => clock })

    expect((await service.translate(call)).ok).toBe(true)
    expect(service.status().activeId).toBe('google-web')

    clock = 999
    await service.translate(call)
    expect(first.calls).toBe(1) // // still cooling down

    clock = 1000
    const back = await service.translate(call)
    expect(back.ok && back.result.provider).toBe('llm')
    expect(service.status().activeId).toBe('llm')
    // Success clears the record: demoted only remains as the most recent reason for display
    expect(service.status().demoted?.kind).toBe('network')
  })

  it('aborted neither demotes nor switches engines: a session cancellation is not the engine\'s fault', async () => {
    const first = step('llm', [fail('aborted', 'cancelled (scope: s1)')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    expect(res.ok).toBe(false)
    expect(second.calls).toBe(0)
    expect(service.status().activeId).toBe('llm')
  })

  it('when the last engine of the chain fails it is reported as it is, and run.ts stops by it', async () => {
    const first = step('llm', [fail('auth')])
    const second = step('google-web', [fail('network')])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    expect(res).toEqual(fail('network'))
  })

  it('with everything demoted it falls back to the last engine rather than no engine at all', async () => {
    const first = step('llm', [fail('auth')])
    const second = step('google-web', [fail('auth'), ok('google-web')])
    const service = createFallbackService([first, second])
    await service.translate(call) // // both auth, both recorded (the last is reported as it is, not recorded)
    const res = await service.translate(call)
    expect(res.ok && res.result.provider).toBe('google-web')
  })

  it('cancel fans out to every queue: miss one and an in-flight request comes back to write into the DOM', () => {
    const first = step('llm', [ok('llm')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    expect(service.cancel('session-1')).toBe(2)
    expect(first.cancelled).toEqual(['session-1'])
    expect(second.cancelled).toEqual(['session-1'])
  })

  it('a permanent demotion does not recover on its own: the background undoes it by rebuilding the whole chain, and this layer offers no reset (issue #42)', async () => {
    const first = step('chrome-builtin', [fail('no-key', 'language pack not downloaded'), ok('chrome-builtin')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    await service.translate(call)
    expect(service.status().activeId).toBe('google-web')
    await service.translate(call)
    expect(first.calls).toBe(1)
    expect('reset' in service).toBe(false)
  })

  it('with a single engine the error is returned as it is, neither swallowed nor changed', async () => {
    const only = step('llm', [fail('auth', 'bad key')])
    const service = createFallbackService([only])
    expect(await service.translate(call)).toEqual(fail('auth', 'bad key'))
    expect(service.status()).toEqual({ configuredId: 'llm', activeId: 'llm', demotions: [] })
  })

  it('an empty chain is a programming error and throws', () => {
    expect(() => createFallbackService([])).toThrow()
  })

  it('the default cooldown is 60 seconds', () => {
    expect(DEFAULT_COOLDOWN_MS).toBe(60_000)
  })

  it('a demotion writes one warning log line, so the reader and e2e can locate it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = createFallbackService([step('llm', [fail('auth', 'bad key')]), step('google-web', [ok('google-web')])])
    await service.translate(call)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('demoted'))
    warn.mockRestore()
  })
})

// Codex on #163: every step of the chain resends the whole call, and the cache key carries the provider,
// so the segments the previous step translated do not hit the cache at the next — whatever it cannot translate is lost
describe('partial success along the fallback chain', () => {
  it('what each step translated goes back together: the main engine gives A, the fallback B, and the caller gets both', async () => {
    const first = step('a', [partialFail('network', ['A'])])
    const second = step('b', [partialFail('network', ['B'])])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.partial?.map(p => p.id).sort()).toEqual(['A', 'B'])
  })

  it('a later step translating the same segment wins: that is the newer result', async () => {
    const first = step('a', [partialFail('network', ['A'])])
    const second = step('b', [{ ok: false, error: { kind: 'network', message: 'x', isolatable: true }, partial: [{ id: 'A', text: '新译文' }] }])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    if (!res.ok) expect(res.partial).toEqual([{ id: 'A', text: '新译文' }])
  })

  it('with nothing translated by any step there is no partial field', async () => {
    const service = createFallbackService([step('a', [fail('network')]), step('b', [fail('network')])])
    const res = await service.translate(call)
    if (!res.ok) expect(res.partial).toBeUndefined()
  })

  it('the succeeding step returns directly as usual, without the earlier steps\' fragments mixed in', async () => {
    const service = createFallbackService([step('a', [partialFail('network', ['A'])]), step('b', [ok('b')])])
    const res = await service.translate(call)
    expect(res.ok).toBe(true)
  })
})
