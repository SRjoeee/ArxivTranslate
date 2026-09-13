import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@/config/schema'
import { BUILT_IN_SERVICES } from '@/config/services'
import { getProvider } from '@/providers'
import { WIRE_FORMATS, wireFormatOfProvider } from '@/providers/wire-formats'

/** A reader's service, whose engine is the OpenAI-compatible kind */
const SVC = { id: 'svc-abcd1234', kind: 'openai-compat' as const, name: 'Mine', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-x', model: 'x/y', thinking: 'disabled' as const }
const KINDS = ['openai-compat', ...BUILT_IN_SERVICES] as const

describe('wire-format metadata (#115)', () => {
  it('the wireFormats each engine factory declares are this table — the settings page reads the table only and must not drift from the implementation', () => {
    // The settings page needs it for one judgement only, “does the sample use tags or markers”, and must not import the engine implementations:
    // measured, the options bundle went 43 kB → 276 kB (the whole AI SDK pulled in). The price is that the metadata and the implementation live apart,
    // and this case is the latch against drift: a literal changed in the factory without the table turns it red
    for (const id of BUILT_IN_SERVICES) {
      const provider = getProvider({ ...DEFAULT_CONFIG, provider: id })
      expect([id, [...provider.wireFormats]]).toEqual([id, [...WIRE_FORMATS[id]]])
    }
    // The reader's own service is the OpenAI-compatible kind whatever it is named
    const own = getProvider({ ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] })
    expect([...own.wireFormats]).toEqual([...WIRE_FORMATS['openai-compat']])
  })

  it('the table covers every engine kind (the three built-ins + OpenAI-compatible), so a new engine cannot be missed', () => {
    expect(Object.keys(WIRE_FORMATS).sort()).toEqual([...KINDS].sort())
  })

  it('the preferred format: markers for Microsoft, tags for the rest', () => {
    expect(wireFormatOfProvider('microsoft')).toBe('markers')
    for (const id of ['openai-compat', 'google-web', 'chrome-builtin', SVC.id] as const) {
      expect([id, wireFormatOfProvider(id)]).toEqual([id, 'tags'])
    }
  })
})
