// Regression tests at the session boundary (issue #45). The originals were three diagnostic probes “asserting the defect exists”, rewritten here as expected behaviour.
import { describe, expect, it, vi } from 'vitest'
import { CancelledScopeRegistry } from '@/providers/request/cancellation'
import { extract } from '@/core/extractor'
import { startTranslation } from '@/core/pipeline'
import { restore } from '@/core/renderer/page'
import { createOpenAICompatProvider } from '@/providers/openai-compat'
import { cacheKeyFor } from '@/cache/key'
import type { CachePort } from '@/providers/translate-service'

const docWith = (html: string) => new DOMParser().parseFromString(
  `<!doctype html><html><body><article class="ltx_document">${html}</article></body></html>`,
  'text/html',
)

const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `<p class="ltx_p">Sentence ${i}.</p>`).join('')

describe('restoring the original during start-up (issue #45, experiment 1)', () => {
  it('after yielding the main thread no mark is written any more: after restore has cleaned up, no orphan data-axt-* may remain', async () => {
    const doc = docWith(paragraphs(40))
    const before = doc.documentElement.outerHTML
    const blocks = extract(doc)
    expect(blocks.length).toBeGreaterThan(1)

    const run = startTranslation({
      doc,
      blocks,
      target: 'cmn',
      mode: 'stack',
      paper: '0000.00000',
      capabilities: { maxBatchChars: 1000, maxBatchItems: 4, renderPath: 'tags' },
      preload: { margin: 1000, threshold: 0 },
      transport: async () => ({ ok: false, error: { kind: 'aborted', message: 'no request should be sent', isolatable: false } }),
    })
    // The marking loop stops as soon as it starts: the initialisation is interrupted when it yields the main thread
    run.stop()
    restore(doc)
    await run.ready

    expect(doc.querySelectorAll('[data-axt-id]')).toHaveLength(0)
    expect(doc.querySelectorAll('[data-axt-state]')).toHaveLength(0)
    // The DOM returns to the initial one node for node (§7.1)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})

describe('the wait budget of cache reads: no CachePort can drag it down (issue #45, experiment 2)', () => {
  /** The minimal service for cache assertions only: the provider echoes, recording the segments really sent */
  const serviceWith = async (cache: CachePort, cacheReadBudgetMs = 20) => {
    const { createTranslateService } = await import('@/providers/translate-service')
    const calls: string[][] = []
    const service = createTranslateService({
      getProvider: async () => ({
        id: 'mock', kind: 'llm', wireFormats: ['tags'] as const, maxBatchChars: 1000, maxBatchItems: 4,
        isAvailable: async () => true,
        translate: async r => { calls.push(r.segments.map(s => s.id)); return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' } },
      }),
      cache,
      cacheReadBudgetMs,
      cancelled: new CancelledScopeRegistry(),
    })
    return { service, calls }
  }
  const call = { request: { segments: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], source: 'en' as const, target: 'cmn' }, cache: { paper: '0000.00000', renderPath: 'tags' as const } }

  it('a normal return is unaffected by the budget, and the segments hit are no longer sent to the provider', async () => {
    const { service, calls } = await serviceWith({ getMany: async keys => keys.map((_, i) => (i === 0 ? { translation: '甲' } : null)), putMany: async () => undefined })
    const res = await service.translate(call)
    expect(res.ok && res.cached).toBe(1)
    expect(calls).toEqual([['b']])
  })

  it('a count mismatch is treated as all misses: taking by index would mismatch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service, calls } = await serviceWith({ getMany: async () => [{ translation: '甲' }], putMany: async () => undefined })
    const res = await service.translate(call)
    expect(res.ok && res.cached).toBe(0)
    expect(calls).toEqual([['a', 'b']])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('count that does not match'))
    warn.mockRestore()
  })

  it('the budget is a constant, a change has to be explicit: the default 2 seconds is far above the measured hit round trip (of the order of 36 ms)', async () => {
    const { CACHE_READ_BUDGET_MS } = await import('@/providers/translate-service')
    expect(CACHE_READ_BUDGET_MS).toBe(2_000)
  })

  it('when the CachePort never returns, past the budget it counts as a miss, the request goes out as usual, and translation is not stuck', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service, calls } = await serviceWith({ getMany: () => new Promise(() => undefined), putMany: async () => undefined })
    const res = await service.translate(call)
    expect(res.ok).toBe(true)
    expect(calls).toEqual([['a', 'b']])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not return'))
    warn.mockRestore()
  })
})

describe('the cache identity includes the endpoint (issue #45, experiment 3)', () => {
  const keyOf = (provider: { id: string; cacheId?: string; promptKey?: string }) => cacheKeyFor({
    providerId: provider.cacheId ?? provider.id,
    model: 'same-model',
    promptKey: provider.promptKey ?? '',
    target: 'cmn',
    renderPath: 'tags',
    text: 'Hello',
  })

  it('the same model name with different base URLs must not hit the same cache entry', async () => {
    const a = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'dummy', model: 'same-model' })
    const b = createOpenAICompatProvider({ baseURL: 'https://two.example/v1', apiKey: 'dummy', model: 'same-model' })
    expect(await keyOf(a)).not.toBe(await keyOf(b))
  })

  it('different paths under one domain are different identities: a gateway route may point at different backends (Codex on #54)', async () => {
    const a = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'dummy', model: 'same-model' })
    const b = createOpenAICompatProvider({ baseURL: 'https://one.example/tenant-b/v1', apiKey: 'dummy', model: 'same-model' })
    expect(await keyOf(a)).not.toBe(await keyOf(b))
  })

  it('a difference of a trailing slash only is still the same identity', async () => {
    const a = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'dummy', model: 'same-model' })
    const b = createOpenAICompatProvider({ baseURL: 'https://one.example/v1/', apiKey: 'dummy', model: 'same-model' })
    expect(await keyOf(a)).toBe(await keyOf(b))
  })

  it('the cache identity holds no API key (hard rule 7)', () => {
    const provider = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'sk-secret-value', model: 'm' })
    expect(provider.cacheId).not.toContain('sk-secret-value')
    expect(provider.cacheId).toBe('openai-compat:https://one.example/v1')
  })

  it('a provider declaring no cacheId still uses its id: the free engines are unaffected', async () => {
    const { createGoogleWebProvider } = await import('@/providers/google-web')
    const google = createGoogleWebProvider()
    expect(google.cacheId).toBeUndefined()
    expect(await keyOf(google)).toBe(await keyOf({ id: 'google-web' }))
  })
})

describe('cancellation crosses the message boundary (issue #42)', () => {
  it('restoring the original: cancel goes to the background with the session scope, and a late successful translation no longer lands in the DOM', async () => {
    const { createMessageTransport } = await import('@/shared/transport')
    const doc = docWith(paragraphs(3))
    const before = doc.documentElement.outerHTML
    const blocks = extract(doc)

    const sent: { type: string }[] = []
    let release: (() => void) | null = null
    const held = new Promise<void>(resolve => { release = resolve })
    // The background stand-in: the translation request hangs, the cancel request answers at once
    const send = (async (message: { type: string; request?: { segments: { id: string; text: string }[] } }) => {
      sent.push(message)
      if (message.type === 'axt:cancel-scope') return { cancelled: 2 }
      await held
      return { ok: true, result: { segments: message.request!.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' }, cached: 0 }
    }) as never
    const transport = createMessageTransport(send)

    const run = startTranslation({
      doc,
      blocks,
      target: 'cmn',
      mode: 'stack',
      paper: '0000.00000',
      capabilities: { maxBatchChars: 1000, maxBatchItems: 10, renderPath: 'tags' },
      preload: { margin: 1000, threshold: 0 },
      scope: 'session-1',
      transport: call => transport.translate(call),
    })
    await run.ready
    const pending = run.translate(blocks)
    // The request has gone out and still hangs at the background's end
    await Promise.resolve()
    expect(sent.map(m => m.type)).toEqual(['axt:translate'])

    // The reader clicks “Show original”: content stops the session, sends the cancel, clears the DOM
    run.stop()
    expect(await transport.cancel('session-1')).toBe(2)
    restore(doc)

    // The request that could not be withdrawn comes back only now
    release!()
    await pending

    expect(sent.map(m => m.type)).toEqual(['axt:translate', 'axt:cancel-scope'])
    expect(doc.querySelectorAll('[data-axt-id]')).toHaveLength(0)
    expect(doc.querySelectorAll('.axt-t')).toHaveLength(0)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})
describe('no cache write after a drop (Codex on #33)', () => {
  it('one call spanning two batches: the batch that finished first is not stored once the scope is dropped', async () => {
    const { createTranslateService } = await import('@/providers/translate-service')
    const writes: string[][] = []
    let release: (() => void) | null = null
    const held = new Promise<void>(resolve => { release = resolve })
    const registry = new CancelledScopeRegistry()
    const service = createTranslateService({
      cancelled: registry,
      // At most 1 per batch: a answers at once, b hangs, released only after the cancel
      getProvider: async () => ({
        id: 'mock', kind: 'llm', wireFormats: ['tags'] as const, maxBatchChars: 1000, maxBatchItems: 1,
        isAvailable: async () => true,
        translate: async r => {
          if (r.segments[0]?.id === 'b') await held
          return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }
        },
      }),
      cache: { getMany: async keys => keys.map(() => null), putMany: async entries => { writes.push(entries.map(e => e.translation)) } },
      batch: { enableFallbackToIndividual: false, maxRetries: 0 },
    })
    const pending = service.translate({
      request: { segments: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], source: 'en', target: 'cmn' },
      cache: { paper: '0000.00000', renderPath: 'tags' },
      scope: 'session-1',
    })
    // Wait for a's batch to land, then drop the scope the way the router does — mark, then drain — and release b
    await new Promise(r => setTimeout(r, 200))
    registry.markScope('session-1')
    service.cancel('session-1')
    release!()
    await pending
    // a succeeded long ago, but the session is over: nothing may be written
    expect(writes).toEqual([])
  })
})

