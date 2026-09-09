// #axt-debug marks blocks and adds dashed outlines. Inject styles only for debugging (not manifest CSS),
// allowing complete removal on restore (DESIGN §7.1). No hashchange listener: refresh after changing the hash.
import { ID_ATTR, markBlocks, type Block } from '@/core/extractor'
import { STYLE_ATTR } from '@/core/renderer'

const DEBUG_ATTR = 'data-axt-debug'
const STYLE_MARK = 'debug'

const STYLE = `
[${DEBUG_ATTR}] [${ID_ATTR}] { outline: 1px dashed rgba(220, 38, 38, 0.7); outline-offset: 2px; }
[${DEBUG_ATTR}] table[${ID_ATTR}] { outline: 2px dashed rgba(37, 99, 235, 0.7); }
`

/** Idempotent: repeated calls do not inject duplicate styles. */
export function enableDebug(blocks: Block[]): void {
  markBlocks(blocks)
  document.documentElement.setAttribute(DEBUG_ATTR, '')
  if (!document.querySelector(`style[${STYLE_ATTR}="${STYLE_MARK}"]`)) {
    const style = document.createElement('style')
    style.setAttribute(STYLE_ATTR, STYLE_MARK)
    style.textContent = STYLE
    document.head.append(style)
  }
}
