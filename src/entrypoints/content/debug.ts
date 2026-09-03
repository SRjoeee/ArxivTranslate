// #axt-debug 调试描边：标记块并给块加虚线框。样式只在调试时注入（不走 manifest CSS），
// 以便恢复原文时能整体移除（DESIGN §7.1）。不监听 hashchange，改 hash 后需刷新页面。
import { ID_ATTR, markBlocks, type Block } from '@/core/extractor'

const DEBUG_ATTR = 'data-axt-debug'
const STYLE_MARK = 'debug'

const STYLE = `
[${DEBUG_ATTR}] [${ID_ATTR}] { outline: 1px dashed rgba(220, 38, 38, 0.7); outline-offset: 2px; }
[${DEBUG_ATTR}] table[${ID_ATTR}] { outline: 2px dashed rgba(37, 99, 235, 0.7); }
`

/** 幂等：重复调用不会注入第二份样式 */
export function enableDebug(blocks: Block[]): void {
  markBlocks(blocks)
  document.documentElement.setAttribute(DEBUG_ATTR, '')
  if (!document.querySelector(`style[data-axt="${STYLE_MARK}"]`)) {
    const style = document.createElement('style')
    style.setAttribute('data-axt', STYLE_MARK)
    style.textContent = STYLE
    document.head.append(style)
  }
}
