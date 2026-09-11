// 摘要页上的双语入口（issue #146）。这里**只做这一件事**：整条翻译流水线一行都不加载。
//
// 语言包是直接读的，不走 `@/ui/strings`：那个模块会把 179 个语言名与外观模块一起拉进来，而这个脚本
// 在每一个 arXiv 摘要页上都跑。要的只是一句话（Codex 在 #161 指出这句话本来是写死的中文）。
import { LOCALES, pickLocale } from '@/locales'
import { injectBilingualLink, relabelBilingualLink } from '@/core/abstract/link'

export default defineContentScript({
  matches: ['https://arxiv.org/abs/*'],
  runAt: 'document_idle',
  async main() {
    // 直接读那一个字段，不走 `getConfig`：它会把 zod、整份 schema 与语言表都拉进这个包，
    // 而这里只要一个字符串。读不到就跟随浏览器，与别处一致
    const stored = await browser.storage.local.get('config').catch(() => ({}))
    const chosen = (stored as { config?: { uiLanguage?: string } }).config?.uiLanguage
    const ui = browser.i18n?.getUILanguage?.()
    const languages = ui ? [ui] : [navigator.language]
    const label = (uiLanguage: string | undefined) => {
      const { S } = LOCALES[pickLocale(uiLanguage, languages)]
      return S.page.abstractLink(S.brand)
    }
    injectBilingualLink(document, label(chosen))

    // 这一页可能一直开着，而读者去设置页把界面语言换了：别处都跟着换了，这里也要跟上（Codex 在 #161 指出）
    browser.storage.local.onChanged.addListener(changes => {
      const next = (changes.config?.newValue as { uiLanguage?: string } | undefined)?.uiLanguage
      if (next !== undefined) relabelBilingualLink(document, label(next))
    })
  },
})
