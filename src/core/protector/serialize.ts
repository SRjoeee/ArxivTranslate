// 序列化（DESIGN §6.2）：块 → 带占位符的文本 + 槽位表。纯读，不改 DOM。
// void / paired 的判定完全复用规则模块：classify() 命中任何类别（skip / protect / unit / table）即 void——
// 这同时覆盖了嵌套单元（脚注容器、段内 .ltx_p）；未命中且含文本的元素是 paired，未命中且无文本的也作 void。
// 唯一例外是表格单元格（§5.3）：extractor 不下钻表格，格里的 .ltx_p / 标题不会另成块，
// 序列化时要当普通 paired 走进去，否则整格只剩一个占位符、文字全丢（实测 2410.00260 表 1；Codex 在 #5 指出）。
import { isInjected } from '@/core/marks'
import { FUNCTIONAL_INLINE, classify, isTableCell } from '@/core/rules/latexml'
import type { WireSpan } from './offsets'
import { escapeText } from './text'
import { type WireFormat, writeVoid } from './tokens'

export interface ProtectedBlock {
  /** 这个块是按哪种线上格式序列化的；validate / rehydrate / splitRuns 据此分词 */
  format: WireFormat
  /** 带占位符的文本；文本节点按 format 转义过（tags 转 & < >，markers 转会引起歧义的 @） */
  text: string
  /** id → 原节点：void 为整个节点，paired 为元素本身（回填时浅克隆） */
  slots: Map<number, Node>
  paired: Set<number>
  /** 超过 VOID_DENSE_THRESHOLD 的块视为公式密集，由 pipeline 单独成批 */
  voidCount: number
  /** Wire offset to DOM mapping; only produced by `serialize(root, format, { offsets: true })` (§6.2, issue #105) */
  offsets?: WireSpan[]
}

export const VOID_DENSE_THRESHOLD = 40

const ELEMENT_NODE = 1
const TEXT_NODE = 3

const hasText = (el: Element) => /\S/.test(el.textContent ?? '')

/**
 * 连续空白折成一个空格、首尾去掉。**必须在这里做，不能只在 pipeline 里改送出去的那一份**：
 * runs 路径送的是 `splitRuns(protected)` 从这个字符串切出来的段，只归一化 `segment.text`
 * 修不到它（#119）。
 *
 * 为什么非做不可：LaTeXML 的 HTML 带硬换行，12 篇 fixture 的 3847 个正文块里 2373 个（62%）有，
 * 合计 7383 个。微软把每个换行当句号——同一段带换行时 `state explosion` 译成「州级爆炸性质」、
 * 切成 5 句，归一化后是「状态爆炸」、2 句；60 段实测里假句边界从 128/266 降到 5/140。
 * HTML 渲染本来就折叠这些空白，所以对 DOM 没有语义损失。
 *
 * 对占位符安全：`<x id="N"/>` / `<t id="N">` 里只有单个空格，`@abc#` 不含空白，
 * 折叠都不会碰到它们。缓存键那边 `normalizeText` 做的是同一件事，所以键不变、旧缓存继续命中，
 * 不需要升 `CACHE_KEY_VERSION`。
 *
 * 跳过的块（`<pre>` / 代码）不走这里：规则模块把它们判成 void，整块进槽位、原样保留。
 *
 * **不能用 `\s`**：JS 的 `\s` 含 U+00A0，而 `&nbsp;` 在 LaTeXML 输出里是有语义的排版
 * （`Section&nbsp;1.1`、`no.&nbsp;1`、`W.&nbsp;Arendt` 都靠它禁止折行），HTML 自己也不折叠它。
 * 只折叠 HTML 规范会折叠的那五个字符。
 *
 * **也不 trim**：块首尾的空白在行内块之间是有渲染意义的——`<span>A</span><span>B</span>` 渲染成
 * `AB`，`<span>A </span>` 才是 `A B`。作者名与联系方式标签就是这种相邻行内块（§5.2），
 * trim 掉会让相邻译文粘连。而要修的是**块内部的硬换行**，折叠就够了，trim 不在需求里。
 */
const HTML_SPACE = /[\t\n\f\r ]+/g
const collapseWhitespace = (text: string) => text.replace(HTML_SPACE, ' ')


/**
 * Writes the wire text character by character while recording where wire offsets land in the DOM.
 * Only taken when offsets are requested: the default path still escapes the whole string at once
 * and collapses once at the end, touching not one extra character, so translation pays nothing.
 *
 * The two paths must emit byte-identical wire text; `tests/protector/offsets.test.ts` pins that
 * across all 12 fixtures in both wire formats.
 */
function makeTracker(format: WireFormat, parts: string[], spans: WireSpan[]) {
  let len = 0
  let afterSpace = false
  return {
    /**
     * A placeholder run. It holds no collapsible whitespace and neither starts nor ends with any,
     * so it goes out verbatim. Recording it as a span matters for ranges: a boundary landing inside
     * a placeholder has to resolve to that node's own boundary, otherwise a sentence opening or
     * closing on a formula would drop it (Codex pointed this out on #123).
     */
    raw(s: string, node: Node, role: 'void' | 'open' | 'close') {
      parts.push(s)
      spans.push({ kind: 'slot', node, from: len, to: len + s.length, role })
      len += s.length
      afterSpace = false
    },
    text(node: Text) {
      const data = node.data
      const from = len
      const anchors: [number, number][] = [[len, 0]]
      let out = ''
      for (let i = 0; i < data.length; i++) {
        const c = data[i]!
        let emitted: string
        if (c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r') {
          emitted = afterSpace ? '' : ' '
          afterSpace = true
        } else {
          emitted = c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : format === 'markers' && c === '@' ? '@@' : c
          afterSpace = false
        }
        out += emitted
        // One input character did not produce exactly one output character, so the 1:1 run
        // restarts here and needs an anchor.
        if (emitted.length !== 1) anchors.push([len + out.length, i + 1])
      }
      if (out.length === 0) return
      parts.push(out)
      len += out.length
      spans.push({ kind: 'text', node, from, to: len, anchors })
    },
  }
}

export function serialize(root: Element, format: WireFormat = 'tags', options: { offsets?: boolean } = {}): ProtectedBlock {
  const slots = new Map<number, Node>()
  const paired = new Set<number>()
  const parts: string[] = []
  const spans: WireSpan[] = []
  const tracker = options.offsets === true ? makeTracker(format, parts, spans) : undefined
  let voidCount = 0
  let next = 1
  const inCell = isTableCell(root)

  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        if (tracker) tracker.text(child as Text)
        else parts.push(escapeText((child as Text).data, format))
      } else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element
        // 我们自己插的译文 / 镜像不是原文：再次翻译时它们已经在原块内部（Codex 在 #8 指出）
        if (isInjected(el)) continue
        const c = classify(el)
        const isVoid = c ? !(inCell && c.kind === 'unit' && hasText(el)) : !hasText(el)
        // markers 没有成对记号（实测 Google 只有 70.6%，见 tokens.ts）：除了「带功能的元素」按 void
        // 整块保留以保住可点击（issue #44 在 runs 路径上的同一条判断），其余成对元素拍平成纯文本，
        // 丢的是内联包装的样式，不是内容
        const flatten = format === 'markers' && !isVoid && !el.matches(FUNCTIONAL_INLINE)
        if (flatten) {
          walk(el)
          continue
        }
        const id = next++
        slots.set(id, el)
        if (isVoid || format === 'markers') {
          voidCount++
          if (tracker) tracker.raw(writeVoid(id, format), el, 'void')
          else parts.push(writeVoid(id, format))
        } else {
          paired.add(id)
          if (tracker) tracker.raw(`<t id="${id}">`, el, 'open')
          else parts.push(`<t id="${id}">`)
          walk(el)
          if (tracker) tracker.raw('</t>', el, 'close')
          else parts.push('</t>')
        }
      }
      // 注释等其他节点忽略
    }
  }
  walk(root)
  // The tracked path collapses as it writes, so it must not be collapsed again.
  const text = tracker ? parts.join('') : collapseWhitespace(parts.join(''))
  return tracker ? { format, text, slots, paired, voidCount, offsets: spans } : { format, text, slots, paired, voidCount }
}
