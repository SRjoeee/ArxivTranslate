import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@/config/schema'
import { BUILT_IN_SERVICES } from '@/config/services'
import { getProvider } from '@/providers'
import { WIRE_FORMATS, wireFormatOfProvider } from '@/providers/wire-formats'

/** A reader's service, whose engine is the OpenAI-compatible kind */
const SVC = { id: 'svc-abcd1234', kind: 'openai-compat' as const, name: 'Mine', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-x', model: 'x/y', thinking: 'disabled' as const }
const KINDS = ['openai-compat', ...BUILT_IN_SERVICES] as const

describe('线上格式元数据（#115）', () => {
  it('每个引擎工厂声明的 wireFormats 就是这张表——设置页只读表，不能与实现漂移', () => {
    // 设置页只为「样本用标签还是记号」这一个判断，不该 import 引擎实现：
    // 实测 options 包 43 kB → 276 kB（整个 AI SDK 被拖进去）。代价是元数据与实现分了家，
    // 这条用例就是防漂移的闩：工厂那边改了字面量而表没改，这里会红
    for (const id of BUILT_IN_SERVICES) {
      const provider = getProvider({ ...DEFAULT_CONFIG, provider: id })
      expect([id, [...provider.wireFormats]]).toEqual([id, [...WIRE_FORMATS[id]]])
    }
    // The reader's own service is the OpenAI-compatible kind whatever it is named
    const own = getProvider({ ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] })
    expect([...own.wireFormats]).toEqual([...WIRE_FORMATS['openai-compat']])
  })

  it('表覆盖了全部引擎种类（三个内置 + OpenAI 兼容），加引擎时不会漏', () => {
    expect(Object.keys(WIRE_FORMATS).sort()).toEqual([...KINDS].sort())
  })

  it('首选格式：微软是记号，其余是标签', () => {
    expect(wireFormatOfProvider('microsoft')).toBe('markers')
    for (const id of ['openai-compat', 'google-web', 'chrome-builtin', SVC.id] as const) {
      expect([id, wireFormatOfProvider(id)]).toEqual([id, 'tags'])
    }
  })
})
