// Session-boundary regressions (issue #45). Three original diagnostic probes asserting defects are rewritten here as expected behavior.
import { describe, expect, it, vi } from 'vitest'
import { extract } from '@/core/extractor'
import { startTranslation } from '@/core/pipeline'
import { restore } from '@/core/renderer'
import { createOpenAICompatProvider } from '@/providers/openai-compat'
import { cacheKeyFor } from '@/cache/key'
import type { CachePort } from '@/providers/translate-service'

const docWith = (html: string) => new DOMParser().parseFromString(
  `<!doctype html><html><body><article class="ltx_document">${html}</article></body></html>`,
  'text/html',
)

const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `<p class="ltx_p">Sentence ${i}.</p>`).join('')

describe('restoring originals during startup (issue #45, experiment 1)', () => {
  it('writes no markers after yielding once stopped, leaving no orphan data-axt-* attributes after restore', async () => {
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
      capabilities: { maxBatchChars: 1000, maxBatchItems: 4, preservesMarkup: true },
      preload: { margin: 1000, threshold: 0 },
      transport: async () => ({ ok: false, error: { kind: 'aborted', message: 'Request should not be sent' } }),
    })
    // Stop just as marking begins, interrupting initialization at the main-thread yield.
    run.stop()
    restore(doc)
    await run.ready

    expect(doc.querySelectorAll('[data-axt-id]')).toHaveLength(0)
    expect(doc.querySelectorAll('[data-axt-state]')).toHaveLength(0)
    // The DOM returns node-for-node to its initial state (§7.1).
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})

describe('cache-read budget prevents any CachePort from stalling translation (issue #45, experiment 2)', () => {
  /** Minimal cache-testing service: an echo provider records segments actually sent */
  const serviceWith = async (cache: CachePort, cacheReadBudgetMs = 20) => {
    const { createTranslateService } = await import('@/providers/translate-service')
    const calls: string[][] = []
    const service = createTranslateService({
      getProvider: async () => ({
        id: 'mock', displayName: 'mock', kind: 'llm', preservesMarkup: true, maxBatchChars: 1000, maxBatchItems: 4,
        isAvailable: async () => true,
        translate: async r => { calls.push(r.segments.map(s => s.id)); return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' } },
      }),
      cache,
      cacheReadBudgetMs,
    })
    return { service, calls }
  }
  const call = { request: { segments: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], source: 'en' as const, target: 'cmn' }, cache: { paper: '0000.00000', renderPath: 'markup' as const } }

  it('normal responses are unaffected by the budget and cache hits are not sent to the provider', async () => {
    const { service, calls } = await serviceWith({ getMany: async keys => keys.map((_, i) => (i === 0 ? '甲' : null)), putMany: async () => undefined })
    const res = await service.translate(call)
    expect(res.ok && res.cached).toBe(1)
    expect(calls).toEqual([['b']])
  })

  it('mismatched result counts become all misses to avoid assigning hits by the wrong index', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service, calls } = await serviceWith({ getMany: async () => ['甲'], putMany: async () => undefined })
    const res = await service.translate(call)
    expect(res.ok && res.cached).toBe(0)
    expect(calls).toEqual([['a', 'b']])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('different item count'))
    warn.mockRestore()
  })

  it('the budget is an explicit constant: 2 seconds comfortably exceeds the measured roughly 36 ms cache round trip', async () => {
    const { CACHE_READ_BUDGET_MS } = await import('@/providers/translate-service')
    expect(CACHE_READ_BUDGET_MS).toBe(2_000)
  })

  it('a CachePort that never returns times out as a miss and requests proceed without stalling translation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service, calls } = await serviceWith({ getMany: () => new Promise(() => undefined), putMany: async () => undefined })
    const res = await service.translate(call)
    expect(res.ok).toBe(true)
    expect(calls).toEqual([['a', 'b']])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not return'))
    warn.mockRestore()
  })
})

describe('cache identity includes the endpoint (issue #45, experiment 3)', () => {
  const keyOf = (provider: { id: string; cacheId?: string; promptKey?: string }) => cacheKeyFor({
    providerId: provider.cacheId ?? provider.id,
    model: 'same-model',
    promptKey: provider.promptKey ?? '',
    target: 'cmn',
    renderPath: 'markup',
    text: 'Hello',
  })

  it('the same model at different Base URLs cannot share a cache entry', async () => {
    const a = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'dummy', model: 'same-model' })
    const b = createOpenAICompatProvider({ baseURL: 'https://two.example/v1', apiKey: 'dummy', model: 'same-model' })
    expect(await keyOf(a)).not.toBe(await keyOf(b))
  })

  it('different paths on one domain have different identities because gateways may route to different backends (Codex #54)', async () => {
    const a = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'dummy', model: 'same-model' })
    const b = createOpenAICompatProvider({ baseURL: 'https://one.example/tenant-b/v1', apiKey: 'dummy', model: 'same-model' })
    expect(await keyOf(a)).not.toBe(await keyOf(b))
  })

  it('a trailing slash alone does not change identity', async () => {
    const a = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'dummy', model: 'same-model' })
    const b = createOpenAICompatProvider({ baseURL: 'https://one.example/v1/', apiKey: 'dummy', model: 'same-model' })
    expect(await keyOf(a)).toBe(await keyOf(b))
  })

  it('cache identity excludes API keys (hard rule 7)', () => {
    const provider = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'sk-secret-value', model: 'm' })
    expect(provider.cacheId).not.toContain('sk-secret-value')
    expect(provider.cacheId).toBe('openai-compat:https://one.example/v1')
  })

  it('providers without cacheId still use id, preserving free-engine behavior', async () => {
    const { createGoogleWebProvider } = await import('@/providers/google-web')
    const google = createGoogleWebProvider()
    expect(google.cacheId).toBeUndefined()
    expect(await keyOf(google)).toBe(await keyOf({ id: 'google-web' }))
  })
})

describe('cancellation crosses the messaging boundary (issue #42)', () => {
  it('restore sends cancel with the session scope to background and prevents late successful translations from reaching the DOM', async () => {
    const { createMessageTransport } = await import('@/shared/transport')
    const doc = docWith(paragraphs(3))
    const before = doc.documentElement.outerHTML
    const blocks = extract(doc)

    const sent: { type: string }[] = []
    let release: (() => void) | null = null
    const held = new Promise<void>(resolve => { release = resolve })
    // Background stub: translation requests stay pending; cancellation returns immediately.
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
      capabilities: { maxBatchChars: 1000, maxBatchItems: 10, preservesMarkup: true },
      preload: { margin: 1000, threshold: 0 },
      scope: 'session-1',
      transport: call => transport.translate(call),
    })
    await run.ready
    const pending = run.translate(blocks)
    // The request has been sent and remains pending in background.
    await Promise.resolve()
    expect(sent.map(m => m.type)).toEqual(['axt:translate'])

    // The user restores originals: content stops the session, sends cancellation, and clears the DOM.
    run.stop()
    expect(await transport.cancel('session-1')).toBe(2)
    restore(doc)

    // The uncancellable request finally returns.
    release!()
    await pending

    expect(sent.map(m => m.type)).toEqual(['axt:translate', 'axt:cancel-scope'])
    expect(doc.querySelectorAll('[data-axt-id]')).toHaveLength(0)
    expect(doc.querySelectorAll('.axt-t')).toHaveLength(0)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})
describe('no cache writes after cancellation (Codex #33)', () => {
  it('when a call spans two batches, even the earlier successful batch is not cached after cancellation', async () => {
    const { createTranslateService } = await import('@/providers/translate-service')
    const writes: string[][] = []
    let release: (() => void) | null = null
    const held = new Promise<void>(resolve => { release = resolve })
    const service = createTranslateService({
      // One segment per batch: a returns immediately; b waits until after cancellation.
      getProvider: async () => ({
        id: 'mock', displayName: 'mock', kind: 'llm', preservesMarkup: true, maxBatchChars: 1000, maxBatchItems: 1,
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
      cache: { paper: '0000.00000', renderPath: 'markup' },
      scope: 'session-1',
    })
    // Wait for batch a, cancel the whole scope, then release b.
    await new Promise(r => setTimeout(r, 200))
    service.cancel('session-1')
    release!()
    await pending
    // Although a succeeded earlier, the cancelled session must perform no writes.
    expect(writes).toEqual([])
  })
})

