// Wire-format negotiation (#104, DESIGN §8.5): one session can have one format only, and the chain takes the intersection.
// Tested with synthetic engines, because the real markers-only engine (Microsoft) only arrives with #98.
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { DEFAULT_CONFIG } from '@/config/schema'
import type { WireFormat } from '@/core/protector'
import { buildChain } from '@/providers'
import type { TranslationProvider } from '@/providers/types'

const engine = (id: string, wireFormats: readonly WireFormat[], available = true): TranslationProvider => ({
  id,

  kind: 'mt',
  wireFormats,
  maxBatchChars: 1000,
  maxBatchItems: 4,
  isAvailable: async () => available,
  translate: async () => ({ segments: [], provider: id }),
})

/** The first choice is google-web (keeps both formats); the free-engine table comes from the test */
const chainOf = (free: TranslationProvider[]) =>
  buildChain({ ...DEFAULT_CONFIG, provider: 'google-web' }, { freeEngines: free.map(p => () => p) })

describe('buildChain\'s format negotiation', () => {
  beforeEach(() => fakeBrowser.reset())

  it('with Google alone it takes tags: it keeps both, tags comes first in the preference order, and inline styles survive', async () => {
    const { chain, renderPath } = await chainOf([])
    expect(chain.map(p => p.id)).toEqual(['google-web'])
    expect(renderPath).toBe('tags')
  })

  it('with a tags-only engine added the intersection is still tags', async () => {
    const { chain, renderPath } = await chainOf([engine('builtin-ish', ['tags'])])
    expect(chain.map(p => p.id)).toEqual(['google-web', 'builtin-ish'])
    expect(renderPath).toBe('tags')
  })

  it('with the first choice preferring tags a markers-only candidate cannot get in — it cannot rescue a tags session', async () => {
    const { chain, renderPath } = await chainOf([engine('microsoft-ish', ['markers'])])
    expect(chain.map(p => p.id)).toEqual(['google-web'])
    expect(renderPath).toBe('tags')
  })

  it('**order-independent**: however the candidate table is ordered, the format and who joins the chain are the same (the precondition of #103)', async () => {
    // This is why the rule exists. The old rule let the intersection shrink with iteration order, so a fallback engine could change the first-choice engine's
    // render format — the reader in #103 only adjusted a fallback priority, and the whole page's inline styles vanished silently
    const markers = () => engine('microsoft-ish', ['markers'])
    const tags = () => engine('builtin-ish', ['tags'])
    const a = await buildChain({ ...DEFAULT_CONFIG, provider: 'google-web' }, { freeEngines: [markers, tags] })
    const b = await buildChain({ ...DEFAULT_CONFIG, provider: 'google-web' }, { freeEngines: [tags, markers] })
    expect(a.chain.map(p => p.id)).toEqual(b.chain.map(p => p.id))
    expect([a.renderPath, b.renderPath]).toEqual(['tags', 'tags'])
    // Concretely: only the one supporting tags gets in
    expect(a.chain.map(p => p.id)).toEqual(['google-web', 'builtin-ish'])
  })

  it('with a markers-only first choice markers is locked in, and Google, keeping both, joins the chain as the fallback', async () => {
    const { chain, renderPath } = await buildChain({ ...DEFAULT_CONFIG }, {
      primary: engine('microsoft-ish', ['markers']),
      freeEngines: [() => engine('builtin-ish', ['tags']), () => engine('google-ish', ['tags', 'markers'])],
    })
    expect(chain.map(p => p.id)).toEqual(['microsoft-ish', 'google-ish'])
    expect(renderPath).toBe('markers')
  })

  it('an unavailable candidate takes no part in the negotiation and must not narrow the intersection', async () => {
    const { chain, renderPath } = await chainOf([engine('microsoft-ish', ['markers'], false), engine('builtin-ish', ['tags'])])
    expect(chain.map(p => p.id)).toEqual(['google-web', 'builtin-ish'])
    expect(renderPath).toBe('tags')
  })

  it('with a first choice keeping neither format it takes runs, and the fallback engines still join — runs sends plain text and needs no common format', async () => {
    // wireFormats: [] is the value DESIGN §8.1 records (the future apple-translate).
    // An empty intersection would block every candidate, and with the first choice down there would be nothing to fall back to (Codex on #107)
    const { chain, renderPath } = await buildChain({ ...DEFAULT_CONFIG, provider: 'google-web', fallback: { enabled: true } }, {
      primary: engine('runs-only', []),
      freeEngines: [() => engine('tags-ish', ['tags']), () => engine('markers-ish', ['markers'])],
    })
    expect(chain.map(p => p.id)).toEqual(['runs-only', 'tags-ish', 'markers-ish'])
    expect(renderPath).toBe('runs')
  })

  it('renderPath is the negotiated wire format itself, with no conversion in between (#116)', async () => {
    // This pins the contract. The real guardrail is the type: `RenderPath = WireFormat | 'runs'`, so `renderPath: format`
    // passes directly; a future third WireFormat flows down of itself rather than being rewritten to tags by a silent `? :`
    for (const fmt of ['tags', 'markers'] as const) {
      const { renderPath } = await buildChain(DEFAULT_CONFIG, { primary: engine('x', [fmt]), freeEngines: [] })
      expect([fmt, renderPath]).toEqual([fmt, fmt])
    }
  })

  it('really choosing Microsoft: the chain is [microsoft, google-web] on markers (#98)', async () => {
    // The real FREE_ENGINES, nothing injected: the built-in engine takes tags only and is dropped for having no intersection with markers;
    // Google keeps both and stays as the fallback — exactly why #104 replaced the boolean with a set
    const { chain, renderPath } = await buildChain({ ...DEFAULT_CONFIG, provider: 'microsoft' })
    expect(chain.map(p => p.id)).toEqual(['microsoft', 'google-web'])
    expect(renderPath).toBe('markers')
  })

  it('Microsoft is not in FREE_ENGINES: choosing Google still takes tags, and inline styles are not dragged down by it (#98)', async () => {
    const { chain, renderPath } = await buildChain({ ...DEFAULT_CONFIG, provider: 'google-web' })
    expect(chain).not.toContainEqual(expect.objectContaining({ id: 'microsoft' }))
    expect(renderPath).toBe('tags')
  })

  it('Microsoft + an unsupported target language: isAvailable is false, but the first choice stays at the head of the chain (the popup\'s hint relies on it)', async () => {
    const { chain } = await buildChain({ ...DEFAULT_CONFIG, provider: 'microsoft', targetLanguage: 'epo' })
    expect(chain[0]?.id).toBe('microsoft')
    expect(await chain[0]!.isAvailable()).toBe(false)
  })

  it('with the fallback off only the first choice remains, and the format is its own preference', async () => {
    const { chain, renderPath } = await buildChain({ ...DEFAULT_CONFIG, provider: 'google-web', fallback: { enabled: false } }, {
      freeEngines: [() => engine('microsoft-ish', ['markers'])],
    })
    expect(chain.map(p => p.id)).toEqual(['google-web'])
    expect(renderPath).toBe('tags')
  })
})
