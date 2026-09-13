import { describe, expect, it } from 'vitest'
import {
  ISO6393_TO_6391, LANG_CODES, LANG_CODE_TO_EN_NAME, LANG_CODE_TO_LOCALE_NAME, LANG_CODE_TO_ZH_NAME,
  englishName, fromBcp47, isLangCode, label, langCodeSchema, toBcp47,
} from '@/config/languages'

// The language table is ported from @read-frog/definitions@0.4.4; guarded here are the consistency between the tables and our own conversion functions
describe('languages', () => {
  it('179 codes, the key sets of the three name tables exactly equal; the BCP-47 table is a subset', () => {
    expect(LANG_CODES).toHaveLength(179)
    expect(new Set(LANG_CODES).size).toBe(179)
    for (const table of [LANG_CODE_TO_EN_NAME, LANG_CODE_TO_ZH_NAME, LANG_CODE_TO_LOCALE_NAME]) {
      expect(Object.keys(table).sort()).toEqual([...LANG_CODES].sort())
    }
    for (const code of Object.keys(ISO6393_TO_6391)) expect(isLangCode(code)).toBe(true)
    expect(langCodeSchema.safeParse('cmn').success).toBe(true)
    expect(langCodeSchema.safeParse('zh-CN').success).toBe(false)
  })

  it('the prompt gets the English name; an unknown code comes back as it is', () => {
    expect(englishName('cmn')).toBe('Simplified Mandarin Chinese')
    expect(englishName('cmn-Hant')).toBe('Traditional Mandarin Chinese')
    expect(englishName('jpn')).toBe('Japanese')
    expect(englishName('klingon')).toBe('klingon')
  })

  it('the settings label: the Chinese name (local spelling), not repeated when the two are the same', () => {
    expect(label('jpn')).toBe('日语（日本語）')
    expect(label('cmn')).toBe('简体中文')
    expect(label('eng')).toBe('英语（English）')
  })

  it('Google takes BCP-47: cmn → zh, cmn-Hant → zh-TW; codes without a two-letter form pass as they are', () => {
    expect(toBcp47('cmn')).toBe('zh')
    expect(toBcp47('cmn-Hant')).toBe('zh-TW')
    expect(toBcp47('jpn')).toBe('ja')
    // yue is zh in the table too, but the endpoint accepts yue directly (measured: it returns Cantonese); squeezed to zh it becomes Mandarin
    expect(toBcp47('yue')).toBe('yue')
    // ckb (Sorani) and kmr (Kurmanji) are both ku in the table; the endpoint tells them apart (measured), so ckb keeps its own code
    expect(toBcp47('ckb')).toBe('ckb')
    expect(ISO6393_TO_6391.ckb).toBe('ku') // the table really squeezes it to ku, which is why the override matters
    // The table calls it "Malay ... (Arabic)"; sending ms gets Latin letters (measured: ms-Arab is what gives Jawi)
    expect(toBcp47('zlm')).toBe('ms-Arab')
    // The three the endpoint cannot do stay as they are (bs / uz / az return exactly the same with or without -Cyrl)
    for (const code of ['bos', 'uzn', 'azj'] as const) expect(toBcp47(code)).toBe(ISO6393_TO_6391[code])
    const noShort = LANG_CODES.find(code => !(code in ISO6393_TO_6391))!
    expect(toBcp47(noShort)).toBe(noShort)
  })

  it('migration: BCP-47 looked up in reverse, exact first, then by primary language, finally falling back to Simplified Chinese', () => {
    expect(fromBcp47('zh-CN')).toBe('cmn')
    expect(fromBcp47('zh-TW')).toBe('cmn-Hant')
    expect(fromBcp47('zh-tw')).toBe('cmn-Hant')
    // Script / region subtags pointing at Traditional all go to cmn-Hant, never quietly swapped for Simplified (Codex on #39, second round)
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
