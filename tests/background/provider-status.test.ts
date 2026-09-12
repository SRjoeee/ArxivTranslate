import { describe, expect, it, vi } from 'vitest'
import { type Config, DEFAULT_CONFIG } from '@/config/schema'
import { createChainHolder } from '@/entrypoints/background/chain'
import { createConfigOffers, providerStatus, statusInForce } from '@/entrypoints/background/provider-status'
import type { TranslationTransport } from '@/providers/transport'

// The provider-status action (INVENTORY P4): a session's chain, the chain in force, or — after a save — a chain
// built from what is stored now, without the popup polling for it

const chainOf = (provider: string): TranslationTransport => ({
  translate: async () => ({ ok: true, result: { segments: [], provider }, cached: 0 }),
  cancel: async () => 0,
  status: async () => ({ providerId: provider, chosen: provider, available: true, maxBatchChars: 1, maxBatchItems: 1, renderPath: 'tags' as const, targetLanguage: 'cmn', promptId: 'default', revision: provider, chain: [provider], demotions: [], engine: { id: provider, displayName: provider } }),
})

function harness() {
  let stored: Config = DEFAULT_CONFIG
  const builds: string[] = []
  /** Reads in flight, released by the test in the order it chooses */
  const reads: (() => void)[] = []
  let holdReads = false
  const holder = createChainHolder({
    owned: () => false,
    load: async config => {
      const from = config ?? stored
      builds.push(from.provider)
      return { config: from, transport: chainOf(from.provider) }
    },
  })
  const load = async () => {
    // What a storage read answers is the store as it stood when the read was issued, however long the answer takes
    const snapshot = stored
    if (holdReads) await new Promise<void>(resolve => { reads.push(resolve) })
    return snapshot
  }
  const offers = createConfigOffers({ load, chain: holder })
  const sessions = new Map<string, TranslationTransport>()
  const deps = { chain: holder, router: { transportFor: (scope: string) => sessions.get(scope) }, offers }
  return { deps, holder, offers, builds, sessions, save: (next: Config) => { stored = next }, hold: () => { holdReads = true }, release: () => reads.shift()?.(), releaseLast: () => reads.pop()?.() }
}

describe('providerStatus', () => {
  it('fresh: a setting saved after the last build answers from a chain built from it, before any storage event arrives', async () => {
    const h = harness()
    expect((await providerStatus(h.deps, {})).providerId).toBe(DEFAULT_CONFIG.provider)
    h.save({ ...DEFAULT_CONFIG, provider: 'google-web' })
    // No storage event has reached the holder; a plain ask still sees the old chain
    expect((await providerStatus(h.deps, {})).providerId).toBe(DEFAULT_CONFIG.provider)
    expect((await providerStatus(h.deps, { fresh: true })).providerId).toBe('google-web')
    expect(h.builds).toEqual([DEFAULT_CONFIG.provider, 'google-web'])
  })

  it('fresh with nothing changed builds nothing: the offer matches what the chain was built from', async () => {
    const h = harness()
    await providerStatus(h.deps, { fresh: true })
    await providerStatus(h.deps, { fresh: true })
    // The storage event arriving after the fresh ask is the same comparison, and starts nothing either
    await h.offers.offer()
    await providerStatus(h.deps, {})
    expect(h.builds).toEqual([DEFAULT_CONFIG.provider])
  })

  it('offers land in order: a read issued before a save cannot land after the offer made for that save (Codex on #182)', async () => {
    const h = harness()
    await providerStatus(h.deps, {})
    h.save({ ...DEFAULT_CONFIG, provider: 'google-web' })
    h.hold()
    const first = h.offers.offer() // the watcher's, issued for the first save: its read is held
    h.save({ ...DEFAULT_CONFIG, provider: 'chrome-builtin' })
    const fresh = providerStatus(h.deps, { fresh: true }) // the popup's, after the second save
    await new Promise(resolve => setTimeout(resolve, 0))
    // Answers come back in the worst order: whatever was issued last answers first. Unordered offers would then
    // land the first save's settings on top of the second's, and the page restart would bind that stale chain
    h.releaseLast()
    await new Promise(resolve => setTimeout(resolve, 0))
    h.releaseLast()
    await first
    expect((await fresh).providerId).toBe('chrome-builtin')
    expect((await providerStatus(h.deps, {})).providerId).toBe('chrome-builtin')
    expect(h.builds.at(-1)).toBe('chrome-builtin')
  })

  it('a session asks about its own chain; fresh is about the chain in force, which a restart binds the page to', async () => {
    const h = harness()
    await providerStatus(h.deps, {})
    h.sessions.set('s1', chainOf('pinned'))
    expect((await providerStatus(h.deps, { scope: 's1' })).providerId).toBe('pinned')
    h.save({ ...DEFAULT_CONFIG, provider: 'google-web' })
    expect((await providerStatus(h.deps, { scope: 's1', fresh: true })).providerId).toBe('google-web')
  })
})

describe('statusInForce', () => {
  /** A holder whose chain in force the test replaces; `replace` fires the signal a real holder fires when a build starts */
  function holderOf(first: TranslationTransport) {
    let inForce = first
    let asked = 0
    let fire: () => void = () => undefined
    let signal = new Promise<void>(resolve => { fire = resolve })
    return {
      chain: { current: async () => { asked++; return inForce }, replaced: () => signal },
      replace: (next: TranslationTransport) => { inForce = next; const done = fire; signal = new Promise<void>(resolve => { fire = resolve }); done() },
      asked: () => asked,
    }
  }
  const never = (name: string): TranslationTransport => ({ ...chainOf(name), status: () => new Promise<never>(() => {}) })

  it('a chain replaced while its probes answer is not the answer: the status describes the chain in force afterwards (S2 review, third pass)', async () => {
    let release: () => void = () => undefined
    const slow: TranslationTransport = { ...chainOf('old'), status: async () => { await new Promise<void>(resolve => { release = resolve }); return { ...(await chainOf('old').status()) } } }
    const h = holderOf(slow)
    const status = statusInForce(h.chain)
    await new Promise(resolve => setTimeout(resolve, 0))
    h.replace(chainOf('new')) // a save landed while the old chain's probes were out
    release()
    expect((await status).providerId).toBe('new')
  })

  it('a probe that never settles on a chain that was replaced is not waited for: the replacement answers (fourth pass)', async () => {
    const h = holderOf(never('stalled'))
    const status = statusInForce(h.chain)
    await new Promise(resolve => setTimeout(resolve, 0))
    h.replace(chainOf('healthy'))
    expect((await status).providerId).toBe('healthy')
  })

  it('a replacement landing after the transport was taken but before its status is awaited is not missed (fifth pass)', async () => {
    // current() hands over the old chain and the replacement lands in the same turn, before the caller subscribes
    let inForce = never('stalled')
    let fire: () => void = () => undefined
    let signal = new Promise<void>(resolve => { fire = resolve })
    const replace = (next: TranslationTransport) => { inForce = next; const done = fire; signal = new Promise<void>(resolve => { fire = resolve }); done() }
    let handed = 0
    const chain = {
      current: async () => { const taken = inForce; if (++handed === 1) replace(chainOf('healthy')); return taken },
      replaced: () => signal,
    }
    expect((await statusInForce(chain)).providerId).toBe('healthy')
  })

  it('a probe that never settles with nothing replacing the chain rejects at the deadline, with no obsolete answer', async () => {
    vi.useFakeTimers()
    try {
      const h = holderOf(never('stalled'))
      const status = statusInForce(h.chain, 1_000)
      const outcome = expect(status).rejects.toThrow(/did not settle/)
      await vi.advanceTimersByTimeAsync(1_000)
      await outcome
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers at once when nothing replaced the chain', async () => {
    const h = holderOf(chainOf('only'))
    const status = await statusInForce(h.chain)
    expect(status.providerId).toBe('only')
    expect(h.asked()).toBe(2)
  })
})
