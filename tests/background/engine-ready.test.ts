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

  it('a deletion whose rebuild fails outright still retires every chain; the sessions keep their tabs, lose their chains', async () => {
    // Nothing to move onto, but the deleted service must stop: every chain is retired and drained. The scope → tab
    // entries stay, unmarked — a tab closing later must still find them (image recognition queues by scope too),
    // and their next request binds whatever chain is in force by then (the local review of ADR-0005, ninth and
    // tenth passes)
    const retired: string[] = []
    const drained: string[] = []
    const registry = new CancelledScopeRegistry()
    let n = 0
    const holder = createChainHolder({
      owned: transport => router.sessionsOn(transport) > 0,
      load: async () => {
        const name = `build-${++n}`
        if (name !== 'build-1') throw new Error(`${name} failed`)
        return { config: DEFAULT_CONFIG, transport: chainOf(name, ['svc-new'], retired) }
      },
    })
    const router = createSessionRouter({ current: () => holder.current(), cancelled: registry, retireOthers: inForce => holder.retireOthers(inForce), onDrop: scope => { drained.push(scope); return 1 } })
    await router.forCall('s1', 1)
    router.bind('ocr-2', 2) // an image-only session on another tab
    expect(await engineReady(holder, router, { id: 'svc-new', rebindAll: true })).toEqual({ reset: false })
    expect(retired).toEqual(['build-1'])
    expect(router.bound()).toEqual(['s1', 'ocr-2'])
    expect(router.transportFor('s1')).toBeUndefined()
    // Closing the tabs afterwards still drops them: marked, and their recognitions drained
    await router.dropTab(2)
    await router.dropTab(1)
    expect(drained).toEqual(['ocr-2', 's1'])
    expect(registry.has('ocr-2')).toBe(true)
    expect(registry.has('s1')).toBe(true)
  })

  it('a deletion whose own rebuild never settles is carried out once another rebuild takes over', async () => {
    // The handler does not wait for its own build: the movers follow current(), which stops waiting for a build the
    // moment it is superseded (the local review of ADR-0005, tenth pass)
    const retired: string[] = []
    const gates = new Map<string, () => void>()
    let n = 0
    const holder = createChainHolder({
      owned: transport => router.sessionsOn(transport) > 0,
      load: async () => {
        const name = `build-${++n}`
        if (name !== 'build-1') await new Promise<void>(resolve => { gates.set(name, resolve) })
        return { config: DEFAULT_CONFIG, transport: chainOf(name, ['svc-new'], retired) }
      },
    })
    const router = createSessionRouter({ current: () => holder.current(), cancelled: new CancelledScopeRegistry(), retireOthers: inForce => holder.retireOthers(inForce) })
    const old = await router.forCall('s1', 1)
    const action = engineReady(holder, router, { id: 'svc-new', rebindAll: true }) // build-2: never released
    void holder.activate() // build-3: another action's rebuild
    gates.get('build-3')!()
    expect(await action).toEqual({ reset: true })
    expect(router.transportFor('s1')).not.toBe(old)
    expect(retired).toEqual(['build-1'])
  })

  it('a language pack whose engine is not on the chain in force answers reset: false', async () => {
    const retired: string[] = []
    let n = 0
    const holder = createChainHolder({ owned: transport => router.sessionsOn(transport) > 0, load: async () => ({ config: DEFAULT_CONFIG, transport: chainOf(`build-${++n}`, ['google-web'], retired) }) })
    const router = createSessionRouter({ current: () => holder.current(), cancelled: new CancelledScopeRegistry(), retireOthers: inForce => holder.retireOthers(inForce) })
    await router.forCall('s1', 1)
    expect(await engineReady(holder, router, { id: 'chrome-builtin', scope: 's1' })).toEqual({ reset: false })
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
