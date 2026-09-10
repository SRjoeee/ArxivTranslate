// Picking the interface's language, for the three pages and for the paper (docs/UI.md §6).
//
// It happens **before the first render**, not during it: a page that painted in one language and
// swapped to another a moment later would flash, and half the values in the popup are computed
// before any component runs. Every entry point awaits this, so nothing is ever half translated.
import { browser } from 'wxt/browser'
import { getConfig } from '@/config/storage'
import { pickLocale } from '@/locales'
import { setLocale } from './strings'

/**
 * What the browser is set to, most preferred first. `getUILanguage` is the browser's own interface
 * language, which is the better guess than the reader's *content* languages: someone reading English
 * papers has English in `accept-languages` without wanting an English interface
 */
function browserLanguages(): string[] {
  const ui = browser.i18n?.getUILanguage?.()
  return ui ? [ui] : (navigator.languages as string[] | undefined) ?? [navigator.language]
}

/** Read the stored choice and set the pack. Returns the code, for a page that wants to show it */
export async function applyLocale(): Promise<void> {
  let chosen: string | undefined
  try {
    chosen = (await getConfig()).uiLanguage
  } catch {
    // Unreadable settings must not leave the interface blank: the browser's language still applies
  }
  setLocale(pickLocale(chosen, browserLanguages()))
}

/** The same choice from a configuration already in hand — the paper's script has just read it */
export function applyLocaleFrom(uiLanguage: string): void {
  setLocale(pickLocale(uiLanguage, browserLanguages()))
}
