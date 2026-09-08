import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '@/config/schema'
import { getProvider } from '@/providers'
import { WIRE_FORMATS, wireFormatOfProvider } from '@/providers/wire-formats'

const IDS = ['openai-compat', 'google-web', 'chrome-builtin', 'microsoft'] as const satisfies readonly Config['provider'][]

describe('线上格式元数据（#115）', () => {
  it('每个引擎工厂声明的 wireFormats 就是这张表——设置页只读表，不能与实现漂移', () => {
    // 设置页只为「样本用标签还是记号」这一个判断，不该 import 引擎实现：
    // 实测 options 包 43 kB → 276 kB（整个 AI SDK 被拖进去）。代价是元数据与实现分了家，
    // 这条用例就是防漂移的闩：工厂那边改了字面量而表没改，这里会红
    for (const id of IDS) {
      const provider = getProvider({ ...DEFAULT_CONFIG, provider: id })
      expect([id, [...provider.wireFormats]]).toEqual([id, [...WIRE_FORMATS[id]]])
    }
  })

  it('表覆盖了 provider 枚举的全部取值，加引擎时不会漏', () => {
    expect(Object.keys(WIRE_FORMATS).sort()).toEqual([...IDS].sort())
  })

  it('首选格式：微软是记号，其余是标签', () => {
    expect(wireFormatOfProvider('microsoft')).toBe('markers')
    for (const id of ['openai-compat', 'google-web', 'chrome-builtin'] as const) {
      expect([id, wireFormatOfProvider(id)]).toEqual([id, 'tags'])
    }
  })
})
