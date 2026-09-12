// 失败态的小部件（DESIGN §7.6）：失败块旁边一个"重试"按钮与带原因的"！"，放在 Shadow DOM 里不受站点样式影响。
// 对应 Read Frog 的 components/translation/error/*（React + jotai + @tabler/icons + base-ui，每个失败块一个 React root）；
// 那套依赖与逐块 React root 是负担（它自己吃过 #1831 的泄漏亏），这里用几十行原生 DOM 做同样的两个控件（§12 的取舍）。
// 与 §7.1 一致：它只是原块的下一个兄弟，restore 删掉宿主节点就干净了。
import type { Block } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { S, parseFatal, reasonText } from '@/ui/strings'
import { ERROR_CLASS, FOR_ATTR } from './attrs'
import { translationShell } from './shell'
import { clearTranslation, setState } from './translation'

/** 原始诊断留在属性里：`restore()` 按注入标记整体清掉，它不进界面 */
export const REASON_ATTR = 'data-axt-reason'

const STYLE = `
:host { display: inline-flex; align-items: center; gap: 4px; font: 12px system-ui, sans-serif; vertical-align: middle; }
button { font: inherit; padding: 0 6px; border: 1px solid var(--axt-failed-color, rgba(220, 38, 38, 0.6)); border-radius: 3px; background: transparent; color: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
.mark { color: var(--axt-failed-color, rgba(220, 38, 38, 0.9)); font-weight: 700; cursor: help; }
`

/** 删掉块旁边的失败小部件（重试开始时）；返回是否删掉了 */
export function clearFailed(block: Block): boolean {
  const parent = block.el.parentElement
  if (!parent) return false
  let removed = false
  for (const sibling of Array.from(parent.children)) {
    if (sibling.classList.contains(ERROR_CLASS) && sibling.getAttribute(FOR_ATTR) === block.id) {
      sibling.remove()
      removed = true
    }
  }
  return removed
}

/**
 * 失败：删掉 pending / 旧译文、标 failed（红线照旧），再插小部件。
 * 点"重试"时按钮禁用并调 retry；小部件由 renderPending 在插圆环之前删掉（见那里）
 */
export function renderFailed(block: Block, reason: string, retry: () => void): Element {
  clearTranslation(block)
  setState(block, 'failed')
  const doc = block.el.ownerDocument
  const host = doc.createElement('span')
  host.className = `${T_CLASS} ${ERROR_CLASS}`
  host.setAttribute(FOR_ATTR, block.id)
  // 说明行的小部件不能作 `<tbody>` 的 `<span>` 子节点：那不合表格的内容模型，
  // 浏览器会把它挪到表外（Codex 在 #168 指出）。用与译文同一套外壳包成 `<tr><td>…</td></tr>`
  const { node: outer, slot } = translationShell(block)
  const widget = outer === slot ? null : outer
  // 读者看到的是按界面语言写的那一句；`kind: 诊断` 里的后半段留着给诊断，不显示（Codex 在 #161 指出）
  const kind = parseFatal(reason)
  host.title = reasonText(kind.kind) || S.page.retry
  host.setAttribute(REASON_ATTR, reason)
  const root = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = STYLE
  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = S.page.retry
  button.addEventListener('click', () => {
    button.disabled = true
    retry()
  })
  const mark = doc.createElement('span')
  mark.className = 'mark'
  mark.title = host.title
  mark.textContent = '！'
  root.append(style, button, mark)
  if (widget) {
    // 外壳自己带 class / data-axt-for，配对与清理都按它来；host 只是里面的那个小部件
    widget.className = host.className
    widget.setAttribute(FOR_ATTR, block.id)
    host.classList.remove(T_CLASS)
    host.removeAttribute(FOR_ATTR)
    slot.append(host)
    block.el.after(widget)
    return widget
  }
  block.el.after(host)
  return host
}

/**
 * Re-label the widgets already on the page. A widget copies the word into its shadow root when it
 * is built, so a page holding failed blocks would keep the previous language until those blocks were
 * retried (Codex on #161). Called when the interface's language changes under an open paper
 */
export function relabelFailed(doc: Document): number {
  const hosts = doc.querySelectorAll<HTMLElement>(`.${ERROR_CLASS}`)
  for (const host of hosts) {
    const root = (host as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot
    const button = root?.querySelector('button')
    if (button) button.textContent = S.page.retry
    // 悬停看到的那句同样要跟着换：它是从 kind 算出来的，原始诊断还留在属性里（Codex 在 #161 指出）
    const reason = host.getAttribute(REASON_ATTR)
    if (reason === null) continue
    host.title = reasonText(parseFatal(reason).kind) || S.page.retry
    const mark = root?.querySelector<HTMLElement>('.mark')
    if (mark) mark.title = host.title
  }
  return hosts.length
}
