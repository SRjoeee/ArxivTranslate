// The #axt-debug outlines: marks the blocks and draws a dashed box around each. The style is injected only when
// debugging (not through the manifest CSS), so restoring the original can remove it whole (DESIGN §7.1). hashchange is not watched; a changed hash needs a reload.
import { ID_ATTR, markBlocks, type Block } from '@/core/extractor'
import { STYLE_ATTR } from '@/core/renderer'

const DEBUG_ATTR = 'data-axt-debug'
const STYLE_MARK = 'debug'

const STYLE = `
[${DEBUG_ATTR}] [${ID_ATTR}] { outline: 1px dashed rgba(220, 38, 38, 0.7); outline-offset: 2px; }
[${DEBUG_ATTR}] table[${ID_ATTR}] { outline: 2px dashed rgba(37, 99, 235, 0.7); }
`

/** Idempotent: a repeated call injects no second copy of the style */
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
