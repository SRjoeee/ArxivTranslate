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

/** Return predefined results in sequence, then repeat the last result */
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
  it('preferred-engine success never touches later engines', async () => {
    const first = step('llm', [ok('llm')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    expect(res.ok && res.result.provider).toBe('llm')
    expect(second.calls).toBe(0)
    expect(service.status()).toEqual({ configuredId: 'llm', activeId: 'llm' })
  })

  it('auth is a configuration error: switches engines and stops trying the preferred engine for the session', async () => {
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

    // The next call goes directly to fallback without wasting another request.
    await service.translate(call)
    expect(first.calls).toBe(1)
    expect(second.calls).toBe(2)
  })

  it('transient-error cooldown expiry retries the preferred engine and success clears demotion state', async () => {
    let clock = 0
    const first = step('llm', [fail('network', 'Connection reset'), ok('llm')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second], { cooldownMs: 1000, now: () => clock })

    expect((await service.translate(call)).ok).toBe(true)
    expect(service.status().activeId).toBe('google-web')

    clock = 999
    await service.translate(call)
    expect(first.calls).toBe(1) // Still cooling down

    clock = 1000
    const back = await service.translate(call)
    expect(back.ok && back.result.provider).toBe('llm')
    expect(service.status().activeId).toBe('llm')
    // Success clears state; demoted remains only to display the latest reason.
    expect(service.status().demoted?.kind).toBe('network')
  })

  it('aborted neither demotes nor switches engines because session cancellation is not an engine failure', async () => {
    const first = step('llm', [fail('aborted', 'Cancelled (scope: s1)')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    expect(res.ok).toBe(false)
    expect(second.calls).toBe(0)
    expect(service.status().activeId).toBe('llm')
  })

  it('reports the final engine failure unchanged so run.ts can stop', async () => {
    const first = step('llm', [fail('auth')])
    const second = step('google-web', [fail('network')])
    const service = createFallbackService([first, second])
    const res = await service.translate(call)
    expect(res).toEqual(fail('network'))
  })

  it('after all demotions, falls back to the last engine rather than leaving no engine', async () => {
    const first = step('llm', [fail('auth')])
    const second = step('google-web', [fail('auth'), ok('google-web')])
    const service = createFallbackService([first, second])
    await service.translate(call) // Both return auth; the final engine reports directly without recording another demotion.
    const res = await service.translate(call)
    expect(res.ok && res.result.provider).toBe('google-web')
  })

  it('cancel fans out to every queue so no missed in-flight reply can mutate the DOM', () => {
    const first = step('llm', [ok('llm')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    expect(service.cancel('session-1')).toBe(2)
    expect(first.cancelled).toEqual(['session-1'])
    expect(second.cancelled).toEqual(['session-1'])
  })

  it('permanent demotions never recover automatically; background rebuilds the chain to reset, with no reset method here (issue #42)', async () => {
    const first = step('chrome-builtin', [fail('no-key', 'Language pack not downloaded'), ok('chrome-builtin')])
    const second = step('google-web', [ok('google-web')])
    const service = createFallbackService([first, second])
    await service.translate(call)
    expect(service.status().activeId).toBe('google-web')
    await service.translate(call)
    expect(first.calls).toBe(1)
    expect('reset' in service).toBe(false)
  })

  it('a single-engine chain returns errors unchanged without swallowing them', async () => {
    const only = step('llm', [fail('auth', 'bad key')])
    const service = createFallbackService([only])
    expect(await service.translate(call)).toEqual(fail('auth', 'bad key'))
    expect(service.status()).toEqual({ configuredId: 'llm', activeId: 'llm' })
  })

  it('an empty chain is a programming error and throws', () => {
    expect(() => createFallbackService([])).toThrow()
  })

  it('defaults to a 60-second cooldown', () => {
    expect(DEFAULT_COOLDOWN_MS).toBe(60_000)
  })

  it('logs one warning on demotion for user and e2e diagnosis', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = createFallbackService([step('llm', [fail('auth', 'bad key')]), step('google-web', [ok('google-web')])])
    await service.translate(call)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('demoted'))
    warn.mockRestore()
  })
})
