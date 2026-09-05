// 失败态的小部件（DESIGN §7.6）：失败块旁边一个"重试"按钮与带原因的"！"，放在 Shadow DOM 里不受站点样式影响。
// 对应 Read Frog 的 components/translation/error/*（React + jotai + @tabler/icons + base-ui，每个失败块一个 React root）；
// 那套依赖与逐块 React root 是负担（它自己吃过 #1831 的泄漏亏），这里用几十行原生 DOM 做同样的两个控件（§12 的取舍）。
// 与 §7.1 一致：它只是原块的下一个兄弟，restore 删掉宿主节点就干净了。
import type { Block } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { FOR_ATTR, clearTranslation, setState } from './index'

export const ERROR_CLASS = 'axt-error'

const STYLE = `
:host { display: inline-flex; align-items: center; gap: 4px; font: 12px system-ui, sans-serif; vertical-align: middle; }
button { font: inherit; padding: 0 6px; border: 1px solid var(--axt-failed-color, rgba(220, 38, 38, 0.6)); border-radius: 3px; background: transparent; color: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
.mark { color: var(--axt-failed-color, rgba(220, 38, 38, 0.9)); font-weight: 700; cursor: help; }
`

/**
 * 失败：删掉 pending / 旧译文、标 failed（红线照旧），再插小部件。
 * 点"重试"时按钮禁用并调 retry——run.ts 会先 clearTranslation 删掉这个小部件再插 pending
 */
export function renderFailed(block: Block, reason: string, retry: () => void): Element {
  clearTranslation(block)
  setState(block, 'failed')
  const doc = block.el.ownerDocument
  const host = doc.createElement('span')
  host.className = `${T_CLASS} ${ERROR_CLASS}`
  host.setAttribute(FOR_ATTR, block.id)
  host.title = reason
  const root = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = STYLE
  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = '重试'
  button.addEventListener('click', () => {
    button.disabled = true
    retry()
  })
  const mark = doc.createElement('span')
  mark.className = 'mark'
  mark.title = reason
  mark.textContent = '！'
  root.append(style, button, mark)
  block.el.after(host)
  return host
}
