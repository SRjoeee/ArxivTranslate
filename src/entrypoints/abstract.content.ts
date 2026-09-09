// 摘要页上的双语入口（issue #146）。这里**只做这一件事**：整条翻译流水线一行都不加载。
import { injectBilingualLink } from '@/core/abstract/link'
export default defineContentScript({
  matches: ['https://arxiv.org/abs/*'],
  runAt: 'document_idle',
  main() {
    injectBilingualLink(document, '双语版本（ArxivTranslate）')
  },
})
