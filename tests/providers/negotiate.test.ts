// 线上格式协商（#104，DESIGN §8.5）：一次会话只能有一种格式，链要取交集。
// 用合成引擎测，因为真的 markers-only 引擎（微软）要到 #98 才接进来。
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { DEFAULT_CONFIG } from '@/config/schema'
import type { WireFormat } from '@/core/protector'
import { buildChain } from '@/providers'
import type { TranslationProvider } from '@/providers/types'

const engine = (id: string, wireFormats: readonly WireFormat[], available = true): TranslationProvider => ({
  id,
  displayName: id,
  kind: 'mt',
  wireFormats,
  maxBatchChars: 1000,
  maxBatchItems: 4,
  isAvailable: async () => available,
  translate: async () => ({ segments: [], provider: id }),
})

/** 首选走 google-web（两种格式都保得住），免费引擎表由测试给 */
const chainOf = (free: TranslationProvider[]) =>
  buildChain({ ...DEFAULT_CONFIG, provider: 'google-web' }, free.map(p => () => p))

describe('buildChain 的格式协商', () => {
  beforeEach(() => fakeBrowser.reset())

  it('只有 Google 时走 tags：它两种都行，偏好序里 tags 在前，内联样式保得住', async () => {
    const { chain, renderPath } = await chainOf([])
    expect(chain.map(p => p.id)).toEqual(['google-web'])
    expect(renderPath).toBe('markup')
  })

  it('接上只认 tags 的引擎，交集仍是 tags', async () => {
    const { chain, renderPath } = await chainOf([engine('builtin-ish', ['tags'])])
    expect(chain.map(p => p.id)).toEqual(['google-web', 'builtin-ish'])
    expect(renderPath).toBe('markup')
  })

  it('接上只认 markers 的引擎，整条链降到 markers——这是微软能进链的原因', async () => {
    const { chain, renderPath } = await chainOf([engine('microsoft-ish', ['markers'])])
    expect(chain.map(p => p.id)).toEqual(['google-web', 'microsoft-ish'])
    expect(renderPath).toBe('markers')
  })

  it('交集一旦收缩到 markers，后面只认 tags 的引擎就进不来了（顺序决定结果）', async () => {
    const { chain, renderPath } = await chainOf([engine('microsoft-ish', ['markers']), engine('builtin-ish', ['tags'])])
    expect(chain.map(p => p.id)).toEqual(['google-web', 'microsoft-ish'])
    expect(renderPath).toBe('markers')
  })

  it('反过来：先接 tags-only，markers-only 的就被挡在外面', async () => {
    const { chain, renderPath } = await chainOf([engine('builtin-ish', ['tags']), engine('microsoft-ish', ['markers'])])
    expect(chain.map(p => p.id)).toEqual(['google-web', 'builtin-ish'])
    expect(renderPath).toBe('markup')
  })

  it('不可用的候选不参与协商，也不该把交集压窄', async () => {
    const { chain, renderPath } = await chainOf([engine('microsoft-ish', ['markers'], false), engine('builtin-ish', ['tags'])])
    expect(chain.map(p => p.id)).toEqual(['google-web', 'builtin-ish'])
    expect(renderPath).toBe('markup')
  })

  it('关掉降级就只剩首选，格式取它自己的偏好', async () => {
    const { chain, renderPath } = await buildChain({ ...DEFAULT_CONFIG, provider: 'google-web', fallback: { enabled: false } }, [
      () => engine('microsoft-ish', ['markers']),
    ])
    expect(chain.map(p => p.id)).toEqual(['google-web'])
    expect(renderPath).toBe('markup')
  })
})
