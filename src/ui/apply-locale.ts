// Picking the interface's language, for the three pages and for the paper (docs/UI.md §6).
//
// It happens **before the first render**, not during it: a page that painted in one language and
// swapped to another a moment later would flash, and half the values in the popup are computed
// before any component runs. Every entry point awaits this, so nothing is ever half translated.
import { browser } from 'wxt/browser'
import { getConfig } from '@/config/storage'
import { type LocaleCode, pickLocale } from '@/locales'
import { S, setLocale } from './strings'

/**
 * What the browser is set to, most preferred first. `getUILanguage` is the browser's own interface
 * language, which is the better guess than the reader's *content* languages: someone reading English
 * papers has English in `accept-languages` without wanting an English interface
 */
function browserLanguages(): string[] {
  const ui = browser.i18n?.getUILanguage?.()
  return ui ? [ui] : (navigator.languages as string[] | undefined) ?? [navigator.language]
}

/**
 * Read the stored choice and set the pack.
 *
 * `title` names the page, in the language just chosen — the tab of the settings page would otherwise
 * keep the Chinese it was born with, whatever the interface says (Codex on #161)
 */
export async function applyLocale(title?: (brand: string) => string): Promise<LocaleCode> {
  const code = await resolveLocale()
  setLocale(code)
  markDocument(code, title)
  return code
}

/**
 * Which pack the settings ask for, **without applying it**. For a caller that has to decide whether
 * to apply at all: the background reads this at startup while a language change may already have
 * landed, and applying first and checking afterwards is how the stale snapshot won (Codex on #161)
 */
export async function resolveLocale(): Promise<LocaleCode> {
  let chosen: string | undefined
  try {
    chosen = (await getConfig()).uiLanguage
  } catch {
    // Unreadable settings must not leave the interface blank: the browser's language still applies
  }
  return pickLocale(chosen, browserLanguages())
}

/** The same choice from a configuration already in hand — the paper's script has just read it */
export function applyLocaleFrom(uiLanguage: string): void {
  setLocale(pickLocale(uiLanguage, browserLanguages()))
}

/**
 * The document says which language it is in. Ours are written in one language at a time, and the
 * three pages ship with `lang="zh-CN"` in their markup: a screen reader would read the English
 * interface aloud in Chinese (Codex on #161). The paper's own `lang` is arXiv's and is never touched
 * — §7.1, and the translations carry their own `lang` per node
 */
function markDocument(code: LocaleCode, title?: (brand: string) => string): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = code
  if (title) document.title = title(S.brand)
}
