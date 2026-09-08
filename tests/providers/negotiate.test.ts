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
  buildChain({ ...DEFAULT_CONFIG, provider: 'google-web' }, { freeEngines: free.map(p => () => p) })

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

  it('首选偏好 tags 时，markers-only 的候选进不来——它救不了 tags 会话', async () => {
    const { chain, renderPath } = await chainOf([engine('microsoft-ish', ['markers'])])
    expect(chain.map(p => p.id)).toEqual(['google-web'])
    expect(renderPath).toBe('markup')
  })

  it('**顺序无关**：候选表怎么排，格式与进链结果都一样（#103 的前置）', async () => {
    // 这是这条规则存在的理由。旧规则让交集随迭代顺序收缩，于是一个兜底引擎能改变首选引擎的
    // 渲染格式——用户在 #103 里只是调一下兜底优先级，整页的内联样式就会静默消失
    const markers = () => engine('microsoft-ish', ['markers'])
    const tags = () => engine('builtin-ish', ['tags'])
    const a = await buildChain({ ...DEFAULT_CONFIG, provider: 'google-web' }, { freeEngines: [markers, tags] })
    const b = await buildChain({ ...DEFAULT_CONFIG, provider: 'google-web' }, { freeEngines: [tags, markers] })
    expect(a.chain.map(p => p.id)).toEqual(b.chain.map(p => p.id))
    expect([a.renderPath, b.renderPath]).toEqual(['markup', 'markup'])
    // 具体是：只有支持 tags 的那个进得来
    expect(a.chain.map(p => p.id)).toEqual(['google-web', 'builtin-ish'])
  })

  it('首选是 markers-only 时锁定 markers，两种都保得住的 Google 进链兜底', async () => {
    const { chain, renderPath } = await buildChain({ ...DEFAULT_CONFIG }, {
      primary: engine('microsoft-ish', ['markers']),
      freeEngines: [() => engine('builtin-ish', ['tags']), () => engine('google-ish', ['tags', 'markers'])],
    })
    expect(chain.map(p => p.id)).toEqual(['microsoft-ish', 'google-ish'])
    expect(renderPath).toBe('markers')
  })

  it('不可用的候选不参与协商，也不该把交集压窄', async () => {
    const { chain, renderPath } = await chainOf([engine('microsoft-ish', ['markers'], false), engine('builtin-ish', ['tags'])])
    expect(chain.map(p => p.id)).toEqual(['google-web', 'builtin-ish'])
    expect(renderPath).toBe('markup')
  })

  it('首选一个格式都保不住时走 runs，兜底引擎照样进链——runs 发的是纯文本，不需要共同格式', async () => {
    // wireFormats: [] 是 DESIGN §8.1 记着的取值（将来的 apple-translate）。
    // 空交集会把每个候选都挡掉，首选一挂就没得降级（Codex 在 #107 指出）
    const { chain, renderPath } = await buildChain({ ...DEFAULT_CONFIG, provider: 'google-web', fallback: { enabled: true } }, {
      primary: engine('runs-only', []),
      freeEngines: [() => engine('tags-ish', ['tags']), () => engine('markers-ish', ['markers'])],
    })
    expect(chain.map(p => p.id)).toEqual(['runs-only', 'tags-ish', 'markers-ish'])
    expect(renderPath).toBe('runs')
  })

  it('关掉降级就只剩首选，格式取它自己的偏好', async () => {
    const { chain, renderPath } = await buildChain({ ...DEFAULT_CONFIG, provider: 'google-web', fallback: { enabled: false } }, {
      freeEngines: [() => engine('microsoft-ish', ['markers'])],
    })
    expect(chain.map(p => p.id)).toEqual(['google-web'])
    expect(renderPath).toBe('markup')
  })
})
