// The document's translation state (DESIGN §7; ADR-0003): the attributes on <html>, the injected
// style sheet, the mode, and the restore that undoes all of it. 全局状态只在 <html> 上（§7.1）。
import type { Look } from '@/config/appearance'
import { isRtlTag } from '@/config/languages'
import { AXT_ATTR_PREFIX, INJECTED_SELECTOR } from '@/core/marks'
import highlightCss from '@/styles/highlight.css?inline'
import imageCss from '@/styles/image.css?inline'
import modesCss from '@/styles/modes.css?inline'
import presetsCss from '@/styles/presets.css?inline'
import { BLUR_ATTR, DIR_ATTR, LANG_ATTR, MODE_ATTR, type Mode, ON_ATTR, STYLE_ATTR, UNDERLINE_ATTR } from './attrs'
import { clearSentenceHighlights } from './highlight'
import { cancelSkeletonsIn } from './skeleton'
import { appearanceRule, customStyleRule } from './style-preset'

const STYLE_MARK = 'modes'

/** What the sheet needs: the reader's active style and band profiles (§7.5). `Look` lives with the profiles */
export type { Look }

/**
 * 注入表的内容。顺序即层叠顺序，两处**必须**保持：
 * - `appearanceRule` 的 `base`（透明度）排在 presetsCss **之前**，让模糊规则能与它复合而不是顶掉它；
 *   `overrides`（颜色与高亮变量）排在**之后**
 * - `customStyleRule` 排在最后：它是进阶逃生口，该有最后的发言权
 */
function styleSheet(look?: Look): string {
  const vars = look ? appearanceRule(look) : { base: '', overrides: '' }
  const custom = look ? customStyleRule(look.style.css) : ''
  return `${modesCss}\n${vars.base}${presetsCss}\n${imageCss}\n${highlightCss}\n${vars.overrides}${custom}`
}

/** The same sheet the page gets, for the settings preview to put in its iframe */
export const appearanceSheet = (look: Look): string => styleSheet(look)

/**
 * Appearance only, no translation node touched (#47): write the profile's switches and recompute the
 * injected sheet. This is the path a colour change in the settings page takes, and it **does not
 * re-request anything** (§8.5's `chainConfigChanged` ignores `style` already). With translation off
 * there is no injected sheet and nothing to do — the next `enable` carries the new values.
 */
export function applyStyle(doc: Document, look: Look): boolean {
  const sheet = doc.querySelector(`style[${STYLE_ATTR}="${STYLE_MARK}"]`)
  if (!sheet) return false
  setAppearanceAttrs(doc, look)
  const css = styleSheet(look)
  if (sheet.textContent !== css) {
    sheet.textContent = css
    // Font size, leading and weight can all change here, and then the line is no longer where the
    // bands were traced. They are absolute boxes in document coordinates and cannot follow a
    // reflow, so drop them; the next pointer move repaints against the new layout (Codex on #138).
    clearSentenceHighlights(doc)
  }
  return true
}

/**
 * 打开翻译态：<html> 上写状态属性，注入模式与外观（幂等）。
 * 外观与模式一样只是 <html> 上的属性（§7.5），换配置不动 DOM；高级 CSS 每次注入时重算
 */
export function enable(doc: Document, mode: Mode, look?: Look, lang?: string): void {
  doc.documentElement.setAttribute(ON_ATTR, '')
  doc.documentElement.setAttribute(MODE_ATTR, mode)
  // 译文的语言记在 <html> 上（§7.1：全局状态只在这里），renderText 逐个写到译文节点的 lang 上。
  // 不能直接改 <html lang>：那会把原文也说成中文
  if (lang) {
    doc.documentElement.setAttribute(LANG_ATTR, lang)
    if (isRtlTag(lang)) doc.documentElement.setAttribute(DIR_ATTR, 'rtl')
    else doc.documentElement.removeAttribute(DIR_ATTR)
  }
  if (look) setAppearanceAttrs(doc, look)
  const existing = doc.querySelector(`style[${STYLE_ATTR}="${STYLE_MARK}"]`)
  const css = styleSheet(look)
  if (existing) {
    // 自定义 CSS 可能变了（设置页改完再翻一次）：内容不同才写，避免无谓的样式重算
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const el = doc.createElement('style')
  el.setAttribute(STYLE_ATTR, STYLE_MARK)
  el.textContent = css
  doc.head.append(el)
}

/**
 * The two switches of the active style, as attributes on `<html>` (§7.5). Everything else the
 * profile carries arrives as a variable, so this is all that changes when the reader picks another
 */
function setAppearanceAttrs(doc: Document, look: Look): void {
  const html = doc.documentElement
  if (look.style.underline === 'none') html.removeAttribute(UNDERLINE_ATTR)
  else html.setAttribute(UNDERLINE_ATTR, look.style.underline)
  if (look.style.blur) html.setAttribute(BLUR_ATTR, '')
  else html.removeAttribute(BLUR_ATTR)
}

/** 模式切换只改一个属性，不经过翻译流程（§4 第 9 步） */
export function setMode(doc: Document, mode: Mode): void {
  // `only` hides the source column outright and `side` re-lays it out, so whatever was tinted is
  // about to be somewhere else or nowhere. The next pointer move repaints it in place.
  clearSentenceHighlights(doc)
  doc.documentElement.setAttribute(MODE_ATTR, mode)
}

/** 恢复原文：删所有注入节点（译文与图片叠加层，§7.1 第 4 条）、剥所有 data-axt-* 属性、移除注入的样式（含 #axt-debug 的） */
export function restore(doc: Document): { removedNodes: number; strippedAttrs: number } {
  // Nothing to undo in the DOM — the highlight only ever lived in `CSS.highlights` — but the
  // painted ranges point at translation nodes about to be removed (§7.7)
  clearSentenceHighlights(doc)
  let removedNodes = 0
  let strippedAttrs = 0
  for (const node of Array.from(doc.querySelectorAll(INJECTED_SELECTOR))) {
    cancelSkeletonsIn(node)
    node.remove()
    removedNodes++
  }
  // 先删样式再剥属性：样式标记本身也是 data-axt-* 属性，剥完就找不到它了
  for (const style of Array.from(doc.querySelectorAll(`style[${STYLE_ATTR}]`))) style.remove()
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith(AXT_ATTR_PREFIX)) {
        el.removeAttribute(attr.name)
        strippedAttrs++
      }
    }
  }
  return { removedNodes, strippedAttrs }
}
