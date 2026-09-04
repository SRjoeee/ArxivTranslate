// LaTeXML 规则模块。所有 ltx_* 选择器只能出现在本文件（CLAUDE.md 硬规则 2）。
// 依据 DESIGN.md §5.1 / §5.2 / §5.3 / §5.6 / §6.1，实测依据见 docs/RESEARCH.md §2。
// 本文件只放数据表与纯函数，不含遍历；遍历在 src/core/extractor。

/** 任何表或函数的行为变化都要递增；进缓存键 */
export const RULES_VERSION = '0.2.0'

/** LaTeXML 类名前缀，用于判断一个元素是否属于论文正文 */
export const LTX_CLASS_PREFIX = 'ltx_'

/** 翻译根：根之外（导航栏、arXiv 注入的页头页脚与弹窗）一律不提取 */
export const DOCUMENT_ROOT = 'article.ltx_document'

export interface Rule {
  id: string
  selector: string
  note: string
}

/** descend：对外层单元是 void，但内部仍可能含独立块（脚注），extractor 要继续下钻 */
export interface ProtectRule extends Rule {
  descend?: boolean
}

/** §5.1 翻译单元：命中且含可翻译文本即成块，并继续下钻发现嵌套单元 */
export const UNIT_RULES: readonly Rule[] = [
  { id: 'p', selector: '.ltx_p', note: '正文段落，可能是 <span>；摘要、列表项、定理内的段落都由本条覆盖' },
  { id: 'title', selector: '.ltx_title, .ltx_subtitle', note: '各级标题、副标题、定理 run-in 标题；内含 .ltx_tag 作 void' },
  { id: 'caption', selector: '.ltx_caption', note: '图表说明；内含 .ltx_tag 作 void' },
  { id: 'footnote', selector: '.ltx_note_content', note: '脚注正文，独立成块；位于 .ltx_note 容器内部' },
  { id: 'bibitem', selector: '.ltx_bibitem', note: '参考文献条目，见 §5.4' },
  { id: 'ack', selector: '.ltx_acknowledgements', note: '致谢' },
  { id: 'keywords', selector: '.ltx_keywords', note: '关键词' },
]

/** §5.3 表格：最外层 .ltx_tabular 作为一个单元（遍历不下钻即取到最外层），单元格是块内的段，th 也带 ltx_td */
export const TABLE_RULES = { root: '.ltx_tabular', cell: '.ltx_td' } as const

/** §5.2 块级整体跳过：不产出、不下钻。出现在翻译单元内部时（如段落里的 .ltx_ERROR）对该单元等价于 void */
export const SKIP_RULES: readonly Rule[] = [
  { id: 'equation', selector: '.ltx_equation, .ltx_equationgroup', note: '行间公式，含其对齐表格与 .ltx_eqn_cell' },
  { id: 'listing', selector: '.ltx_listing, .ltx_listingline, .ltx_listing_data, .ltx_verbatim, pre, code', note: '代码、算法框内的行、verbatim、隐藏的代码数据' },
  { id: 'authors', selector: '.ltx_authors, .ltx_creator, .ltx_personname, .ltx_author_notes, .ltx_role_affiliation, .ltx_contact, .ltx_dates', note: '作者、机构、联系方式、日期' },
  { id: 'pubnotes', selector: '.ltx_pubnotes', note: '出版元数据（ACM 模板的 CCS / DOI / 期刊）' },
  { id: 'picture', selector: 'svg, .ltx_picture', note: 'TikZ 图，实测无可翻译文字（§15.1）' },
  { id: 'error', selector: '.ltx_ERROR', note: 'LaTeXML 转换错误' },
  { id: 'nav', selector: '.ltx_page_navbar, .ltx_TOC', note: '导航栏与目录；位于翻译根之外，供渲染层隐藏用' },
]

/** §6.1 受保护的行内节点：作 void 占位符，不产出；默认不下钻 */
export const PROTECT_RULES: readonly ProtectRule[] = [
  { id: 'math', selector: 'math, .ltx_Math', note: '行内公式；行间公式已被 equation 整块跳过' },
  { id: 'ref', selector: '.ltx_ref', note: '交叉引用，含内部 .ltx_ref_tag' },
  { id: 'cite', selector: '.ltx_cite', note: '引用标记' },
  { id: 'tag', selector: '.ltx_tag', note: '章节号、图表号、公式编号、列表符号、代码行号' },
  { id: 'tt', selector: '.ltx_text.ltx_font_typewriter', note: '等宽文本，视为代码' },
  { id: 'note', selector: '.ltx_note', descend: true, note: '脚注容器：对外层段落是 void，内部的 .ltx_note_content 仍要被发现为块' },
  { id: 'note-mark', selector: '.ltx_note_mark, .ltx_note_type', note: '脚注标记与类型标签（容器外层与正文内各一次）' },
  { id: 'img', selector: 'img', note: '行内图片' },
  { id: 'br', selector: 'br', note: '换行' },
]

/** §15.1 图片统计用选择器（审计脚本） */
export const FIGURE_SELECTORS = { figure: '.ltx_figure', graphics: 'img.ltx_graphics' } as const

export type RuleKind = 'skip' | 'table' | 'unit' | 'protect'

export interface Classification {
  kind: RuleKind
  /** 命中的规则 id；table 恒为 'table' */
  rule: string
  /** extractor 是否继续下钻发现嵌套块 */
  descend: boolean
}

const TABLE_CLASSIFICATION: Classification = { kind: 'table', rule: 'table', descend: false }

/** §5.6：同一元素命中多类时取 skip > table > unit > protect；都不命中返回 null */
export function classify(el: Element): Classification | null {
  const skip = SKIP_RULES.find(r => el.matches(r.selector))
  if (skip) return { kind: 'skip', rule: skip.id, descend: false }
  if (el.matches(TABLE_RULES.root)) return TABLE_CLASSIFICATION
  const unit = UNIT_RULES.find(r => el.matches(r.selector))
  if (unit) return { kind: 'unit', rule: unit.id, descend: true }
  const protect = PROTECT_RULES.find(r => el.matches(r.selector))
  if (protect) return { kind: 'protect', rule: protect.id, descend: protect.descend ?? false }
  return null
}

/** 文档主标题：靠 text-align:center 居中，不能与译文同行（§7.3） */
const DOCUMENT_TITLE = '.ltx_title_document'

/** 短标题同行的候选：title 单元里除文档主标题外的标题（长度另由渲染层判断） */
export function isInlineTitleCandidate(el: Element): boolean {
  return classify(el)?.rule === 'title' && !el.matches(DOCUMENT_TITLE)
}

export function documentRoot(doc: Document | Element): Element | null {
  return doc.querySelector(DOCUMENT_ROOT)
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/**
 * 排除 protect / skip 子树后的文本，不 trim（§6.2 要求保留公式两侧的细空格）。
 * 不看 descend 标志：脚注正文对外层段落不是可见文本，descend 只影响 extractor 的块发现。
 */
export function visibleText(el: Element): string {
  const parts: string[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        parts.push((child as Text).data)
      } else if (child.nodeType === ELEMENT_NODE) {
        const kind = classify(child as Element)?.kind
        if (kind !== 'skip' && kind !== 'protect') walk(child as Element)
      }
    }
  }
  walk(el)
  return parts.join('')
}

const LETTER = /\p{L}/u

/** 可翻译 = 可见文本里至少有一个 Unicode 字母；只含公式、编号、标点的块不成块 */
export function hasTranslatableText(el: Element): boolean {
  return LETTER.test(visibleText(el))
}

// §5.3 数值格：必须含数字（避免 ERROR 这类以 E 开头的词被当成指数）；纯符号格；N/A；空格
const NUMERIC_CELL = /^(?=.*\d)[\s\d.,+\-±×^%()/*eE−–—:;~<>=≤≥∼]+(\s*[a-zA-Zμ°%]{1,4})?$/
const SYMBOL_CELL = /^[✓✗✔✘–—−\-·×*]+$/
const NA_CELL = /^N\/A$/

/** 输入应为 visibleText 的结果（已排除公式）；命中即原样复制，不翻译 */
export function isNumericCell(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  return t === '' || NUMERIC_CELL.test(t) || SYMBOL_CELL.test(t) || NA_CELL.test(t)
}
