import { describe, expect, it } from 'vitest'
import {
  ISO6393_TO_6391, LANG_CODES, LANG_CODE_TO_EN_NAME, LANG_CODE_TO_LOCALE_NAME, LANG_CODE_TO_ZH_NAME,
  englishName, fromBcp47, isLangCode, label, langCodeSchema, toBcp47,
} from '@/config/languages'

// 语言表移植自 @read-frog/definitions@0.4.4；这里守的是表之间的一致性与我们自己的转换函数
describe('languages', () => {
  it('179 个码，三张名称表键集合完全一致；BCP-47 表是子集', () => {
    expect(LANG_CODES).toHaveLength(179)
    expect(new Set(LANG_CODES).size).toBe(179)
    for (const table of [LANG_CODE_TO_EN_NAME, LANG_CODE_TO_ZH_NAME, LANG_CODE_TO_LOCALE_NAME]) {
      expect(Object.keys(table).sort()).toEqual([...LANG_CODES].sort())
    }
    for (const code of Object.keys(ISO6393_TO_6391)) expect(isLangCode(code)).toBe(true)
    expect(langCodeSchema.safeParse('cmn').success).toBe(true)
    expect(langCodeSchema.safeParse('zh-CN').success).toBe(false)
  })

  it('prompt 里填英文名；不认识的码原样返回', () => {
    expect(englishName('cmn')).toBe('Simplified Mandarin Chinese')
    expect(englishName('cmn-Hant')).toBe('Traditional Mandarin Chinese')
    expect(englishName('jpn')).toBe('Japanese')
    expect(englishName('klingon')).toBe('klingon')
  })

  it('设置页标签：中文名（本地写法），两者相同时不重复', () => {
    expect(label('jpn')).toBe('日语（日本語）')
    expect(label('cmn')).toBe('简体中文')
    expect(label('eng')).toBe('英语（English）')
  })

  it('Google 用 BCP-47：cmn → zh、cmn-Hant → zh-TW；没有两字母码的原样传', () => {
    expect(toBcp47('cmn')).toBe('zh')
    expect(toBcp47('cmn-Hant')).toBe('zh-TW')
    expect(toBcp47('jpn')).toBe('ja')
    // 表里 yue 也是 zh，但端点直接认 yue（实测返回粤语）；压成 zh 就成了普通话
    expect(toBcp47('yue')).toBe('yue')
    // ckb（索拉尼）与 kmr（库尔曼吉）表里都是 ku，端点分得清（实测），ckb 保留原码
    expect(toBcp47('ckb')).toBe('ckb')
    expect(toBcp47('kmr')).toBe('ku')
    const noShort = LANG_CODES.find(code => !(code in ISO6393_TO_6391))!
    expect(toBcp47(noShort)).toBe(noShort)
  })

  it('迁移：BCP-47 反查，精确优先、再按主语言、最后回退简体中文', () => {
    expect(fromBcp47('zh-CN')).toBe('cmn')
    expect(fromBcp47('zh-TW')).toBe('cmn-Hant')
    expect(fromBcp47('zh-tw')).toBe('cmn-Hant')
    // 文字 / 地区子标签指向繁体的都归 cmn-Hant，不能悄悄换成简体（Codex 在 #39 第二轮指出）
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
