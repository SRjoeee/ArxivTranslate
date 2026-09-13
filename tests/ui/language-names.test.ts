// Language names (UI.md §6): the table shown in the interface and the table sent to the model are two different things.
// The owner's report of 2026-09-11: in the English interface the language row read "Simplified Mandarin Chinese (简体中…)",
// long and truncated, while the Chinese interface showed a tidy 「简体中文」.
import { describe, expect, it } from 'vitest'
import { LANG_CODES, LANG_CODE_TO_EN_NAME, LANG_CODE_TO_EN_UI_NAME, LANG_CODE_TO_ZH_NAME, englishName, label } from '@/config/languages'
import { languageLabel, languageName, setLocale } from '@/ui/strings'

describe('language names in the interface', () => {
  it('the row writes one name only; the native name is left to the menu', () => {
    setLocale('en')
    expect(languageName('cmn')).toBe('Chinese (Simplified)')
    expect(languageLabel('cmn')).toBe('Chinese (Simplified) (简体中文)')
    expect(languageName('jpn')).toBe('Japanese')
    expect(languageLabel('jpn')).toBe('Japanese (日本語)')
    setLocale('zh-CN')
    expect(languageName('jpn')).toBe('日语')
    expect(languageLabel('jpn')).toBe('日语（日本語）')
    // When the two names are the same anyway, the menu writes it once too
    expect(languageLabel('cmn')).toBe('简体中文')
  })

  it('what goes to the model is still the ISO 639-3 scholarly name: changing it means bumping PROMPT_VERSION and voiding every LLM cache', () => {
    expect(englishName('cmn')).toBe('Simplified Mandarin Chinese')
    expect(englishName('arb')).toBe('Standard Arabic')
    // The interface table is an overlay on top of it, not another copy: entries not overridden are identical character for character
    expect(LANG_CODE_TO_EN_UI_NAME.jpn).toBe(LANG_CODE_TO_EN_NAME.jpn)
  })

  it('overridden names read like product names, keeping the directional words and script notes that belong', () => {
    expect(LANG_CODE_TO_EN_UI_NAME.ell).toBe('Greek') // not Modern Greek (1453-)
    expect(LANG_CODE_TO_EN_UI_NAME.swh).toBe('Swahili') // not Swahili (individual language)
    // Directional words that really distinguish are kept: they name different languages
    expect(LANG_CODE_TO_EN_UI_NAME.fry).toBe('Western Frisian')
    expect(LANG_CODE_TO_EN_UI_NAME.nso).toBe('Northern Sotho')
    // Script notes are kept: the reader really gets that script, and dropping it would be a shock
    expect(LANG_CODE_TO_EN_UI_NAME.zlm).toBe('Malay (Jawi)')
    expect(LANG_CODE_TO_EN_UI_NAME.uzn).toBe('Uzbek (Cyrillic)')
  })

  // Codex on #165: the name table may be a partial one (UI.md §6 “without a language-name table read the English name”),
  // and with different fallbacks in the row and the menu one language would read Chinese (Simplified) in the row and its scholarly name in the menu
  it('with a partial name table the row and the menu fall back to the same name', () => {
    // An interface-language name table holding Japanese only: Chinese has to take the fallback
    expect(label('cmn', { jpn: '日本語' })).toBe('Chinese (Simplified) (简体中文)')
    expect(label('jpn', { jpn: '日本語' })).toBe('日本語')
  })

  it('none of the three tables may repeat a name: two identical rows in the menu leave the reader unable to choose', () => {
    for (const [label, table] of [['the English interface', LANG_CODE_TO_EN_UI_NAME], ['the Chinese interface', LANG_CODE_TO_ZH_NAME]] as const) {
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
