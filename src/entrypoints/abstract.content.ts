// The bilingual entry on the abstract page (issue #146). **This one thing only**: not a line of the translation pipeline is loaded.
//
// The locale pack is read directly, not through `@/ui/strings`: that module pulls in 179 language names and the
// appearance module, and this script runs on every arXiv abstract page. All it needs is one sentence (Codex on #161: the sentence used to be hard-coded Chinese).
import { LOCALES, pickLocale } from '@/locales'
import { injectBilingualLink, relabelBilingualLink } from '@/core/abstract/link'

export default defineContentScript({
  matches: ['https://arxiv.org/abs/*'],
  runAt: 'document_idle',
  async main() {
    // Reads that one field directly, not through `getConfig`: that would pull zod, the whole schema and the language
    // table into this bundle, and only one string is needed here. Unreadable, it follows the browser, as everywhere else
    const stored = await browser.storage.local.get('config').catch(() => ({}))
    const chosen = (stored as { config?: { uiLanguage?: string } }).config?.uiLanguage
    const ui = browser.i18n?.getUILanguage?.()
    const languages = ui ? [ui] : [navigator.language]
    const label = (uiLanguage: string | undefined) => {
      const { S } = LOCALES[pickLocale(uiLanguage, languages)]
      return S.page.abstractLink(S.brand)
    }
    injectBilingualLink(document, label(chosen))

    // This page may stay open while the reader changes the interface language on the settings page: everywhere else follows, and so must this (Codex on #161)
    browser.storage.local.onChanged.addListener(changes => {
      const next = (changes.config?.newValue as { uiLanguage?: string } | undefined)?.uiLanguage
      if (next !== undefined) relabelBilingualLink(document, label(next))
    })
  },
})
