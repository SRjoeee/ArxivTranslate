// The interface's own languages (docs/UI.md §6). Separate from `targetLanguage`, which is what the
// paper is translated into: a reader in Tokyo may well translate into Japanese and want the buttons
// in Japanese too, but the two are different choices and neither implies the other.
//
// Adding a language is one file and one line in LOCALES. Everything else follows: the type comes
// from the Chinese pack, so a missing key does not compile, and the settings menu is built from
// this table. English is the fallback — not because the readers are English speakers (a reader of
// English needs no translator on arXiv) but because it is the one language a paper-reading audience
// can be assumed to get by in when their own is not here yet.
import { LANG_CODE_TO_EN_NAME, LANG_CODE_TO_ZH_NAME, type LangCode } from '@/config/languages'
import { en } from './en'
import { zh } from './zh-CN'

/**
 * The Chinese pack's shape with its literals widened: `brand: 'Read arXiv'` becomes `string`, so
 * another pack can hold another sentence, while a **missing** key still fails to compile. Tuples
 * keep their length (the two stop lists have a fixed number of steps)
 */
type Widen<T> =
  T extends string ? string
    : T extends (...args: infer A) => infer R ? (...args: A) => R
      : T extends object ? { readonly [K in keyof T]: Widen<T[K]> }
        : T

export type Locale = Widen<typeof zh>
export type LocaleCode = keyof typeof LOCALES

export const LOCALES = {
  'zh-CN': zh,
  en,
} as const

/** Each language in its own name, which is the only name a reader looking for it will recognise */
export const LOCALE_NAMES: Record<LocaleCode, string> = {
  'zh-CN': '简体中文',
  en: 'English',
}

/**
 * Which set of language names each interface language uses for the target-language menu. A pack
 * does not carry its own copy of 179 language names — adding a language must stay one small file —
 * so it points at a table instead, and a language without one reads them in English
 */
export const LOCALE_LANGUAGE_NAMES: Record<LocaleCode, Partial<Record<LangCode, string>>> = {
  'zh-CN': LANG_CODE_TO_ZH_NAME,
  en: LANG_CODE_TO_EN_NAME,
}

export const FALLBACK_LOCALE: LocaleCode = 'en'
export const LOCALE_CODES = Object.keys(LOCALES) as LocaleCode[]

export const isLocaleCode = (value: string): value is LocaleCode => value in LOCALES

/**
 * Which pack to use, given what the reader chose and what the browser reports. `chosen` wins when
 * it names a language we have; otherwise the browser's list is walked in order, exact code first
 * (`zh-CN`) and then the bare language (`zh` matching `zh-CN`, `zh-TW` matching it too for now —
 * one Chinese pack is closer than English). Nothing matches: English.
 */
export function pickLocale(chosen: string | undefined, uiLanguages: readonly string[]): LocaleCode {
  if (chosen && chosen !== 'auto' && isLocaleCode(chosen)) return chosen
  for (const tag of uiLanguages) {
    if (isLocaleCode(tag)) return tag
    const base = tag.split('-')[0]?.toLowerCase()
    if (!base) continue
    const near = LOCALE_CODES.find(code => code.toLowerCase().split('-')[0] === base)
    if (near) return near
  }
  return FALLBACK_LOCALE
}
