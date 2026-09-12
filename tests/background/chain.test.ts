import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '@/config/schema'
import { createChainHolder } from '@/entrypoints/background/chain'
import type { TranslationTransport } from '@/providers/transport'

// The chain in force (ADR-0005): one build at a time is the answer, and it is the one in force when the answer arrives

const transport = (name: string) => ({ name }) as unknown as TranslationTransport
const nameOf = (t: TranslationTransport) => (t as unknown as { name: string }).name

describe('createChainHolder', () => {
  it('builds lazily on the first current() and keeps that build', async () => {
    let builds = 0
    const holder = createChainHolder({ owned: () => false, load: async config => { builds++; return { config: config ?? DEFAULT_CONFIG, transport: transport(`build-${builds}`) } } })
    expect(nameOf(await holder.current())).toBe('build-1')
    expect(nameOf(await holder.current())).toBe('build-1')
    expect(builds).toBe(1)
  })

  it('a configuration change rebuilds only when a field that shapes the chain changed', async () => {
    let builds = 0
    const holder = createChainHolder({ owned: () => false, load: async config => { builds++; return { config: config ?? DEFAULT_CONFIG, transport: transport(`build-${builds}`) } } })
    await holder.current()
    holder.onConfig({ ...DEFAULT_CONFIG, mode: 'only' }) // volatile: the display mode
    expect(nameOf(await holder.current())).toBe('build-1')
    holder.onConfig({ ...DEFAULT_CONFIG, targetLanguage: 'ja' }) // shapes the chain
    expect(nameOf(await holder.current())).toBe('build-2')
  })

  it('current() answers with the build in force when it resolves, not the one in force when it was asked', async () => {
    // A rebuild held on its engine probes while a newer one finishes: a mover that awaited the older build would
    // move the sessions back onto it and retire the chain in force (the local review of ADR-0005, sixth pass)
    const gates = new Map<string, () => void>()
    const holder = createChainHolder({
      owned: () => false,
      load: async config => {
        const built = config as Config
        await new Promise<void>(resolve => { gates.set(built.targetLanguage, resolve) })
        return { config: built, transport: transport(built.targetLanguage) }
      },
    })
    void holder.activate({ ...DEFAULT_CONFIG, targetLanguage: 'B' })
    const asked = holder.current() // awaiting B
    void holder.activate({ ...DEFAULT_CONFIG, targetLanguage: 'C' })
    gates.get('C')!()
    gates.get('B')!()
    expect(nameOf(await asked)).toBe('C')
    expect(nameOf(await holder.current())).toBe('C')
  })

  it('a superseded build that fails is ignored: current() follows the build in force', async () => {
    // B was awaited, C took over and finished, then B failed: the failure is nobody's answer any more — a mover
    // that took it would abort the deletion's drain although a replacement is there (the local review of
    // ADR-0005, seventh pass)
    const gates = new Map<string, { ok: () => void; fail: () => void }>()
    const holder = createChainHolder({
      owned: () => false,
      load: async config => {
        const built = config as Config
        await new Promise<void>((resolve, reject) => { gates.set(built.targetLanguage, { ok: resolve, fail: () => reject(new Error(`${built.targetLanguage} failed`)) }) })
        return { config: built, transport: transport(built.targetLanguage) }
      },
    })
    void holder.activate({ ...DEFAULT_CONFIG, targetLanguage: 'B' }).catch(() => undefined)
    const asked = holder.current()
    void holder.activate({ ...DEFAULT_CONFIG, targetLanguage: 'C' })
    gates.get('C')!.ok()
    gates.get('B')!.fail()
    expect(nameOf(await asked)).toBe('C')
  })

  it('retireOthers() retires every build but the one in force, once', async () => {
    const retired: string[] = []
    const make = (name: string) => ({ name, retire: () => { retired.push(name) } }) as unknown as TranslationTransport
    let n = 0
    const holder = createChainHolder({ owned: () => false, load: async config => ({ config: config ?? DEFAULT_CONFIG, transport: make(`build-${++n}`) }) })
    await holder.current()
    await holder.activate()
    const inForce = await holder.activate()
    holder.retireOthers(inForce.transport)
    expect(retired).toEqual(['build-1', 'build-2'])
    holder.retireOthers(inForce.transport)
    expect(retired).toEqual(['build-1', 'build-2']) // forgotten once retired
  })

  it('a superseded build nothing uses is let go at the next current(); one with a session on it or a call inside is kept for retirement', async () => {
    // A worker that lives through many configuration changes must not keep every chain it ever built
    const owned = new Set<TranslationTransport>()
    let busyOne: TranslationTransport | null = null
    const retired: string[] = []
    let n = 0
    const make = (): TranslationTransport => {
      const name = `build-${++n}`
      const self = { name, retire: () => { retired.push(name) }, busy: () => busyOne === self } as unknown as TranslationTransport
      return self
    }
    const holder = createChainHolder({ owned: t => owned.has(t), load: async config => ({ config: config ?? DEFAULT_CONFIG, transport: make() }) })
    const first = await holder.current()
    owned.add(first) // a page still reads on it
    busyOne = (await holder.activate()).transport // a connection test still inside it
    await holder.activate() // nothing on this one
    await holder.activate() // nor on this one
    const inForce = await holder.current() // the sweep: build-3 and build-4 are let go
    holder.retireOthers(inForce)
    expect(retired).toEqual(['build-1', 'build-2'])
  })

  it('a failed build is retried by the next configuration change', async () => {
    let fail = true
    const holder = createChainHolder({ owned: () => false, load: async config => { if (fail) throw new Error('boom'); return { config: config ?? DEFAULT_CONFIG, transport: transport('ok') } } })
    await expect(holder.current()).rejects.toThrow('boom')
    fail = false
    holder.onConfig(DEFAULT_CONFIG)
    expect(nameOf(await holder.current())).toBe('ok')
  })
})
