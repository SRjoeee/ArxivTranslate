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
    const holder = createChainHolder({ load: async config => { builds++; return { config: config ?? DEFAULT_CONFIG, transport: transport(`build-${builds}`) } } })
    expect(nameOf(await holder.current())).toBe('build-1')
    expect(nameOf(await holder.current())).toBe('build-1')
    expect(builds).toBe(1)
  })

  it('a configuration change rebuilds only when a field that shapes the chain changed', async () => {
    let builds = 0
    const holder = createChainHolder({ load: async config => { builds++; return { config: config ?? DEFAULT_CONFIG, transport: transport(`build-${builds}`) } } })
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

  it('a failed build is retried by the next configuration change', async () => {
    let fail = true
    const holder = createChainHolder({ load: async config => { if (fail) throw new Error('boom'); return { config: config ?? DEFAULT_CONFIG, transport: transport('ok') } } })
    await expect(holder.current()).rejects.toThrow('boom')
    fail = false
    holder.onConfig(DEFAULT_CONFIG)
    expect(nameOf(await holder.current())).toBe('ok')
  })
})
