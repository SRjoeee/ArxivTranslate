import { describe, expect, it } from 'vitest'
import {
  ISO6393_TO_6391, LANG_CODES, LANG_CODE_TO_EN_NAME, LANG_CODE_TO_LOCALE_NAME, LANG_CODE_TO_ZH_NAME,
  englishName, fromBcp47, isLangCode, label, langCodeSchema, toBcp47,
} from '@/config/languages'

// Language tables are ported from @read-frog/definitions@0.4.4; these tests cover table consistency and our conversion functions.
describe('languages', () => {
  it('all three name tables have the same 179 keys; the BCP-47 table is a subset', () => {
    expect(LANG_CODES).toHaveLength(179)
    expect(new Set(LANG_CODES).size).toBe(179)
    for (const table of [LANG_CODE_TO_EN_NAME, LANG_CODE_TO_ZH_NAME, LANG_CODE_TO_LOCALE_NAME]) {
      expect(Object.keys(table).sort()).toEqual([...LANG_CODES].sort())
    }
    for (const code of Object.keys(ISO6393_TO_6391)) expect(isLangCode(code)).toBe(true)
    expect(langCodeSchema.safeParse('cmn').success).toBe(true)
    expect(langCodeSchema.safeParse('zh-CN').success).toBe(false)
  })

  it('uses English names in prompts and returns unknown codes unchanged', () => {
    expect(englishName('cmn')).toBe('Simplified Mandarin Chinese')
    expect(englishName('cmn-Hant')).toBe('Traditional Mandarin Chinese')
    expect(englishName('jpn')).toBe('Japanese')
    expect(englishName('klingon')).toBe('klingon')
  })

  it('settings labels use the English name and native spelling without duplicating identical names', () => {
    expect(label('jpn')).toBe('Japanese (日本語)')
    expect(label('cmn')).toBe('Simplified Mandarin Chinese (简体中文)')
    expect(label('eng')).toBe('English')
  })

  it('Google uses BCP-47: cmn → zh and cmn-Hant → zh-TW; codes without two-letter equivalents pass through', () => {
    expect(toBcp47('cmn')).toBe('zh')
    expect(toBcp47('cmn-Hant')).toBe('zh-TW')
    expect(toBcp47('jpn')).toBe('ja')
    // The table maps yue to zh, but the endpoint accepts yue and returns Cantonese; zh would request Mandarin.
    expect(toBcp47('yue')).toBe('yue')
    // The table maps both Sorani ckb and Kurmanji kmr to ku, but the endpoint distinguishes them; preserve ckb.
    expect(toBcp47('ckb')).toBe('ckb')
    expect(ISO6393_TO_6391.ckb).toBe('ku') // The table really maps to ku, making the override meaningful.
    // The table says "Malay ... (Arabic)"; ms returns Latin script, while testing confirmed ms-Arab returns Jawi.
    expect(toBcp47('zlm')).toBe('ms-Arab')
    // Keep the three unsupported variants unchanged: adding -Cyrl to bs, uz, or az produces identical results.
    for (const code of ['bos', 'uzn', 'azj'] as const) expect(toBcp47(code)).toBe(ISO6393_TO_6391[code])
    const noShort = LANG_CODES.find(code => !(code in ISO6393_TO_6391))!
    expect(toBcp47(noShort)).toBe(noShort)
  })

  it('migration resolves BCP-47 by exact match, then primary language, then Simplified Chinese fallback', () => {
    expect(fromBcp47('zh-CN')).toBe('cmn')
    expect(fromBcp47('zh-TW')).toBe('cmn-Hant')
    expect(fromBcp47('zh-tw')).toBe('cmn-Hant')
    // Script and region subtags denoting Traditional Chinese map to cmn-Hant and never silently switch to Simplified Chinese (Codex #39, round 2).
    for (const tag of ['ZH-Hant-TW', 'zh-Hant', 'zh-HK', 'zh-MO', 'zh-Hant-HK']) expect(fromBcp47(tag)).toBe('cmn-Hant')
    expect(fromBcp47('zh-Hans')).toBe('cmn')
    expect(fromBcp47('zh-Hans-SG')).toBe('cmn')
    expect(fromBcp47('zh')).toBe('cmn')
    expect(fromBcp47('ja')).toBe('jpn')
    expect(fromBcp47('en')).toBe('eng')
    expect(fromBcp47('en-US')).toBe('eng')
    expect(fromBcp47('cmn')).toBe('cmn')
    expect(fromBcp47('xx-YY')).toBe('cmn')
  })
})
