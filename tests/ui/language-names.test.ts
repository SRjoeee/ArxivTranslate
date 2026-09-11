// 语言名（UI.md §6）：界面里显示的那张表与发给模型的那张表是两件事。
// 用户 2026-09-11 反馈：英文界面下语言行写着 "Simplified Mandarin Chinese (简体中…)"，
// 又长又截断，而中文界面显示的是干净的「简体中文」。
import { describe, expect, it } from 'vitest'
import { LANG_CODES, LANG_CODE_TO_EN_NAME, LANG_CODE_TO_EN_UI_NAME, LANG_CODE_TO_ZH_NAME, englishName } from '@/config/languages'
import { languageLabel, languageName, setLocale } from '@/ui/strings'

describe('界面里的语言名', () => {
  it('行里只写一个名字，母语名留给菜单', () => {
    setLocale('en')
    expect(languageName('cmn')).toBe('Chinese (Simplified)')
    expect(languageLabel('cmn')).toBe('Chinese (Simplified) (简体中文)')
    expect(languageName('jpn')).toBe('Japanese')
    expect(languageLabel('jpn')).toBe('Japanese (日本語)')
    setLocale('zh-CN')
    expect(languageName('jpn')).toBe('日语')
    expect(languageLabel('jpn')).toBe('日语（日本語）')
    // 两个名字本来就相同时，菜单里也只写一遍
    expect(languageLabel('cmn')).toBe('简体中文')
  })

  it('发给模型的仍是 ISO 639-3 的学名：改它要动 PROMPT_VERSION、让全站 LLM 缓存作废', () => {
    expect(englishName('cmn')).toBe('Simplified Mandarin Chinese')
    expect(englishName('arb')).toBe('Standard Arabic')
    // 界面那张表是在它之上覆盖出来的，不是另抄一份：没覆盖的条目逐字相同
    expect(LANG_CODE_TO_EN_UI_NAME.jpn).toBe(LANG_CODE_TO_EN_NAME.jpn)
  })

  it('覆盖过的名字读起来像产品名，方位词与文字标注该留的留', () => {
    expect(LANG_CODE_TO_EN_UI_NAME.ell).toBe('Greek') // 不是 Modern Greek (1453-)
    expect(LANG_CODE_TO_EN_UI_NAME.swh).toBe('Swahili') // 不是 Swahili (individual language)
    // 真区分的方位词保留：它们指的是不同的语言
    expect(LANG_CODE_TO_EN_UI_NAME.fry).toBe('Western Frisian')
    expect(LANG_CODE_TO_EN_UI_NAME.nso).toBe('Northern Sotho')
    // 文字标注保留：读者拿到的确实是那种文字，去掉就成了惊吓
    expect(LANG_CODE_TO_EN_UI_NAME.zlm).toBe('Malay (Jawi)')
    expect(LANG_CODE_TO_EN_UI_NAME.uzn).toBe('Uzbek (Cyrillic)')
  })

  it('三张表都不许重名：菜单里两行一模一样，读者没法选', () => {
    for (const [label, table] of [['英文界面', LANG_CODE_TO_EN_UI_NAME], ['中文界面', LANG_CODE_TO_ZH_NAME]] as const) {
      const seen = new Map<string, string[]>()
      for (const code of LANG_CODES) {
        const name = table[code]
        if (name) seen.set(name, [...(seen.get(name) ?? []), code])
      }
      const dups = [...seen.entries()].filter(([, codes]) => codes.length > 1)
      expect([label, dups]).toEqual([label, []])
    }
  })
})
