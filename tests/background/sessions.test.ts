// Session-to-chain binding (the two P1 findings in Codex #59)
import { describe, expect, it } from 'vitest'
import { createSessionRouter } from '@/entrypoints/background/sessions'
import type { TranslationTransport } from '@/providers/transport'

/** Bookkeeping-only fake transport: identifies the chain and records cancelled scopes */
function fakeTransport(name: string, cancelled: string[] = []): TranslationTransport & { name: string; cancelled: string[] } {
  return {
    name,
    cancelled,
    translate: async () => ({ ok: true, result: { segments: [], provider: name }, cached: 0 }),
    cancel: async scope => { cancelled.push(`${name}:${scope}`); return 1 },
    status: async () => ({ providerId: name, available: true, maxBatchChars: 1, maxBatchItems: 1, preservesMarkup: true, chain: [name], engine: { id: name, displayName: name } }),
  } as TranslationTransport & { name: string; cancelled: string[] }
}

const nameOf = (t: TranslationTransport) => (t as unknown as { name: string }).name

describe('createSessionRouter', () => {
  it('a session keeps its initial chain through configuration changes; only later sessions use the new chain', async () => {
    const first = fakeTransport('old-chain')
    const second = fakeTransport('new-chain')
    let current = first
    const router = createSessionRouter(async () => current)

    expect(nameOf(await router.forCall('session-1', 1))).toBe('old-chain')
    // The user changes the prompt or target language in the popup; background rebuilds the chain.
    current = second
    // Active sessions keep the old chain so their prompt or language cannot change midway.
    expect(nameOf(await router.forCall('session-1', 1))).toBe('old-chain')
    // A new session in another tab gets the new chain.
    expect(nameOf(await router.forCall('session-2', 2))).toBe('new-chain')
  })

  it('unscoped calls (settings connection tests) always use the current chain without bookkeeping', async () => {
    const first = fakeTransport('old-chain')
    const second = fakeTransport('new-chain')
    let current = first
    const router = createSessionRouter(async () => current)
    expect(nameOf(await router.forCall(undefined, undefined))).toBe('old-chain')
    current = second
    expect(nameOf(await router.forCall(undefined, undefined))).toBe('new-chain')
    expect(router.bound()).toEqual([])
  })

  it('cancels a scope on its bound chain, not the current one, so the old queue cannot keep sending requests', async () => {
    const first = fakeTransport('old-chain')
    const second = fakeTransport('new-chain')
    let current = first
    const router = createSessionRouter(async () => current)
    await router.forCall('session-1', 1)
    current = second
    expect(await router.drop(['session-1'])).toBe(1)
    expect(first.cancelled).toEqual(['old-chain:session-1'])
    expect(second.cancelled).toEqual([])
    expect(router.bound()).toEqual([])
  })

  it('also cancels unbound scopes: a worker restart may lose bindings while queued tasks remain', async () => {
    const only = fakeTransport('chain')
    const router = createSessionRouter(async () => only)
    expect(await router.drop(['orphan-session'])).toBe(1)
    expect(only.cancelled).toEqual(['chain:orphan-session'])
  })

  it('closing a tab cancels its sessions without affecting other tabs', async () => {
    const t = fakeTransport('chain')
    const router = createSessionRouter(async () => t)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 2)
    expect(await router.dropTab(1)).toBe(1)
    expect(t.cancelled).toEqual(['chain:session-1'])
    expect(router.bound()).toEqual(['session-2'])
    // Closing a tab with no session is a no-op.
    expect(await router.dropTab(99)).toBe(0)
  })

  it('a new scope in the same tab cancels the previous session when navigation or reload bypassed endRun', async () => {
    const t = fakeTransport('chain')
    const router = createSessionRouter(async () => t)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 1)
    expect(t.cancelled).toEqual(['chain:session-1'])
    expect(router.bound()).toEqual(['session-2'])
  })

  it('rebindAll migrates active sessions to the new chain only for explicit user actions such as completing a language download', async () => {
    const first = fakeTransport('old-chain')
    const second = fakeTransport('new-chain')
    let current = first
    const router = createSessionRouter(async () => current)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 2)
    current = second
    // Without migration, the popup promise to use the offline engine for subsequent paragraphs would be false.
    router.rebindAll(second)
    expect(nameOf(await router.forCall('session-1', 1))).toBe('new-chain')
    expect(nameOf(await router.forCall('session-2', 2))).toBe('new-chain')
    // Bindings, including tabId, survive migration so closing the tab still cancels its session.
    expect(await router.dropTab(1)).toBe(1)
    expect(second.cancelled).toEqual(['new-chain:session-1'])
  })

  it('identically named scopes in different tabs are independent (a safeguard despite unique session IDs)', async () => {
    const t = fakeTransport('chain')
    const router = createSessionRouter(async () => t)
    await router.forCall('s', 1)
    await router.forCall('s', 1)
    expect(router.bound()).toEqual(['s'])
    expect(t.cancelled).toEqual([])
  })

  it('onDrop also cancels other scope-bound queues such as image OCR (§15.2), including their counts in the result', async () => {
    const transport = fakeTransport('chain')
    const dropped: string[] = []
    const router = createSessionRouter(async () => transport, { onDrop: scope => { dropped.push(scope); return 2 } })
    await router.forCall('s1', 1)
    await router.forCall('s2', 2)
    expect(await router.drop(['s1'])).toBe(3) // Transport cancels 1; onDrop cancels 2.
    expect(await router.dropTab(2)).toBe(3)
    expect(dropped).toEqual(['s1', 's2'])
  })

  it('bind records the tab synchronously without building a chain; dropTab can cancel it, and forCall later fills the chain while retaining the tab', async () => {
    const transport = fakeTransport('chain')
    let built = 0
    const dropped: string[] = []
    const router = createSessionRouter(async () => { built++; return transport }, { onDrop: scope => { dropped.push(scope); return 1 } })
    router.bind('s1', 7)
    expect(built).toBe(0)
    expect(router.bound()).toEqual(['s1'])
    expect(nameOf(await router.forCall('s1', 7))).toBe('chain')
    expect(built).toBe(1)
    expect(await router.dropTab(7)).toBe(2) // Transport cancels 1; onDrop cancels 1.
    expect(dropped).toEqual(['s1'])
    expect(router.bound()).toEqual([])
    // bind also cancels the old scope when the same tab starts a new one
    router.bind('s2', 8)
    router.bind('s3', 8)
    await Promise.resolve()
    expect(router.bound()).toEqual(['s3'])
  })

  it('drop calls onDrop before building a chain; a bind-only session needs no chain to cancel, since engine detection may stall (Codex #87)', async () => {
    const transport = fakeTransport('chain')
    const order: string[] = []
    const router = createSessionRouter(async () => { order.push('current'); return transport }, { onDrop: scope => { order.push(`onDrop:${scope}`); return 1 } })
    router.bind('ocr-only', 3)
    expect(await router.dropTab(3)).toBe(1)
    expect(order).toEqual(['onDrop:ocr-only']) // No current call
    // For sessions that translated text, onDrop still precedes transport.cancel.
    await router.forCall('s1', 4)
    order.length = 0
    await router.dropTab(4)
    expect(order[0]).toBe('onDrop:s1')
    expect(transport.cancelled).toContain('chain:s1')
  })

  it('cancelling while bind → forCall builds a chain cannot resurrect the session; cancel the returned chain too and keep later bind/forCall calls cancelled (Codex #87)', async () => {
    const transport = fakeTransport('chain')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const router = createSessionRouter(async () => { await held; return transport }, { onDrop: () => 1 })
    router.bind('s1', 5)
    const pending = router.forCall('s1', 5) // Awaiting current()
    await Promise.resolve()
    expect(await router.dropTab(5)).toBe(1) // Only onDrop: no chain exists to cancel yet.
    release()
    await pending
    expect(router.bound()).toEqual([]) // Not resurrected
    expect(transport.cancelled).toEqual(['chain:s1']) // forCall cancels the returned chain.
    // Later bind is ignored; forCall returns the chain only after cancelling.
    router.bind('s1', 5)
    expect(router.bound()).toEqual([])
    await router.forCall('s1', 5)
    expect(router.bound()).toEqual([])
    expect(transport.cancelled).toEqual(['chain:s1', 'chain:s1'])
  })
})
