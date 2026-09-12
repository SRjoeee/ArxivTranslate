import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@/config/schema'
import { createChainHolder } from '@/entrypoints/background/chain'
import { engineReady } from '@/entrypoints/background/engine-ready'
import { createSessionRouter } from '@/entrypoints/background/sessions'
import { CancelledScopeRegistry } from '@/providers/request/cancellation'
import type { TranslationTransport } from '@/providers/transport'

// The engine-ready action acts on the chain in force, whatever became of its own rebuild (ADR-0005)

const chainOf = (name: string, engines: string[], retired: string[]): TranslationTransport => ({
  translate: async () => ({ ok: true, result: { segments: [], provider: name }, cached: 0 }),
  cancel: async () => 0,
  status: async () => ({ providerId: name, available: true, maxBatchChars: 1, maxBatchItems: 1, renderPath: 'tags' as const, targetLanguage: 'cmn', promptId: 'default', chain: engines, demotions: [], revision: 1, engine: { id: name, displayName: name } }),
  retire: () => { retired.push(name) },
})

describe('engineReady', () => {
  it('a deletion whose own rebuild fails after a newer one succeeded still moves every session and retires the old chains', async () => {
    // The configuration watcher rebuilt as well and finished first; this handler's rebuild then failed. Acting only
    // on its own success would skip the move and the retirement, and the deleted service's chain would go on
    // serving the next request (the local review of ADR-0005, eighth pass)
    const retired: string[] = []
    const gates = new Map<string, { ok: () => void; fail: () => void }>()
    let n = 0
    const holder = createChainHolder({
      owned: transport => router.sessionsOn(transport) > 0,
      load: async () => {
        const name = `build-${++n}`
        if (name !== 'build-1') await new Promise<void>((resolve, reject) => { gates.set(name, { ok: resolve, fail: () => reject(new Error(`${name} failed`)) }) })
        return { config: DEFAULT_CONFIG, transport: chainOf(name, ['svc-new'], retired) }
      },
    })
    const registry = new CancelledScopeRegistry()
    const router = createSessionRouter({ current: () => holder.current(), cancelled: registry, retireOthers: inForce => holder.retireOthers(inForce) })
    const old = await router.forCall('s1', 1) // on build-1
    const action = engineReady(holder, router, { id: 'svc-new', rebindAll: true }) // build-2, held
    void holder.activate() // build-3: the watcher's rebuild, finishes first
    gates.get('build-3')!.ok()
    await Promise.resolve()
    gates.get('build-2')!.fail()
    expect(await action).toEqual({ reset: true })
    expect(router.transportFor('s1')).not.toBe(old)
    expect(retired).toEqual(['build-1'])
  })

  it('moves one session for a downloaded language pack, and answers whether the engine is on the chain in force', async () => {
    const retired: string[] = []
    let n = 0
    const holder = createChainHolder({ owned: transport => router.sessionsOn(transport) > 0, load: async () => ({ config: DEFAULT_CONFIG, transport: chainOf(`build-${++n}`, n > 1 ? ['chrome-builtin', 'google-web'] : ['google-web'], retired) }) })
    const router = createSessionRouter({ current: () => holder.current(), cancelled: new CancelledScopeRegistry(), retireOthers: inForce => holder.retireOthers(inForce) })
    const before = await router.forCall('s1', 1)
    await router.forCall('s2', 2)
    expect(await engineReady(holder, router, { id: 'chrome-builtin', scope: 's1' })).toEqual({ reset: true })
    expect(router.transportFor('s1')).not.toBe(before)
    expect(router.transportFor('s2')).toBe(before) // the other tab keeps the chain it started on
    expect(retired).toEqual([]) // nothing deleted, nothing retired
  })
})
