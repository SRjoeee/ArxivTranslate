// LaTeXML 规则模块。所有 ltx_* 选择器只能出现在本文件（CLAUDE.md 硬规则 2）。
// 依据 DESIGN.md §5.1 / §5.2 / §5.3 / §5.6 / §6.1，实测依据见 docs/RESEARCH.md §2。
// 本文件只放数据表与纯函数，不含遍历；遍历在 src/core/extractor。

/** 任何表或函数的行为变化都要递增；进缓存键 */
export const RULES_VERSION = '0.3.0'

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
  // 参考文献：条目内按 .ltx_bibblock 分段翻，作者段由 skip 规则排除，译文只跟在标题段下面（§5.4）；
  // 没有分段的条目（natbib 等样式）整条作一个单元兜底
  { id: 'bibblock', selector: '.ltx_bibblock', note: '参考文献条目内的片段（作者 / 标题 / 出处），见 §5.4' },
  { id: 'bibitem', selector: '.ltx_bibitem:not(:has(.ltx_bibblock))', note: '没有分段的参考文献条目，整条一个单元' },
  { id: 'ack', selector: '.ltx_acknowledgements', note: '致谢' },
  { id: 'keywords', selector: '.ltx_keywords', note: '关键词' },
  // 作者区默认翻译（§5.2 修订）：机构、联系方式、日期都是有信息量的文字；
  // 姓名与邮箱另由 skip / protect 排除
  { id: 'authorinfo', selector: '.ltx_contact, .ltx_role_affiliation, .ltx_role_address, .ltx_dates, .ltx_date', note: '作者的机构、联系方式、日期' },
  // 以下结构没在抓过的真实论文里出现，靠 tests/fixtures/arxiv/synthetic-structures.html 守护（RESEARCH.md §2.12）
  { id: 'dedicatory', selector: '.ltx_role_dedicatory', note: '献词' },
  { id: 'item', selector: '.ltx_item', note: '列表项 / description 术语的裸文本；项内有 .ltx_p 时由 p 规则接管' },
  { id: 'marginal', selector: '.ltx_marginpar', note: '边注' },
  { id: 'indexentry', selector: '.ltx_indexentry', note: '索引词条；页码由 .ltx_indexrefs 作占位符' },
  { id: 'cv', selector: '.ltx_cv_item_label, .ltx_cv_item_content, .ltx_cv_entry_date', note: 'CV 模板的条目字段' },
]

/** §5.3 表格：最外层 .ltx_tabular 作为一个单元（遍历不下钻即取到最外层），单元格是块内的段，th 也带 ltx_td */
export const TABLE_RULES = { root: '.ltx_tabular', cell: '.ltx_td' } as const

/** §5.2 块级整体跳过：不产出、不下钻。出现在翻译单元内部时（如段落里的 .ltx_ERROR）对该单元等价于 void */
export const SKIP_RULES: readonly Rule[] = [
  { id: 'equation', selector: '.ltx_equation, .ltx_equationgroup', note: '行间公式，含其对齐表格与 .ltx_eqn_cell' },
  { id: 'listing', selector: '.ltx_listing, .ltx_listingline, .ltx_listing_data, .ltx_verbatim, pre, code', note: '代码、算法框内的行、verbatim、隐藏的代码数据' },
  // 作者区不再整块跳过（§5.2 修订）：只排除翻了会坏事的部分
  { id: 'personname', selector: '.ltx_personname', note: '作者姓名：音译后引用检索会失效' },
  { id: 'author-glue', selector: '.ltx_author_before, .ltx_author_after', note: '作者之间的连接词（“ and ”“, ”），单独成块会打断姓名列表' },
  { id: 'classification', selector: '.ltx_classification', note: 'MSC / ACM 分类号，如“Primary: 11L07”' },
  { id: 'pubnotes', selector: '.ltx_pubnotes', note: '出版元数据（ACM 模板的 CCS / DOI / 期刊）' },
  { id: 'picture', selector: 'svg, .ltx_picture', note: 'TikZ 图，实测无可翻译文字（§15.1）' },
  { id: 'error', selector: '.ltx_ERROR, .ltx_FATAL, .ltx_WARNING, .ltx_INFO', note: 'LaTeXML 的转换错误与提示，不是论文内容' },
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
  { id: 'mailto', selector: 'a[href^="mailto:"]', note: '邮箱地址原样保留' },
  { id: 'indexrefs', selector: '.ltx_indexrefs', note: '索引词条后面的页码列表' },
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
/**
 * 参考文献条目里的作者段（§5.4）：分成多段的条目，第一段固定是作者列表。
 * 只有部分模板会标 .ltx_bib_author（20 篇实测 13 篇有），所以按位置判断而不是按类名；
 * 只有一段的条目（natbib 等样式）整条就是引文，不能跳过。
 */
export function isBibAuthorBlock(el: Element): boolean {
  if (!el.matches('.ltx_bibblock')) return false
  const siblings = Array.from(el.parentElement?.children ?? []).filter(child => child.matches('.ltx_bibblock'))
  return siblings.length > 1 && siblings[0] === el
}

export function classify(el: Element): Classification | null {
  if (isBibAuthorBlock(el)) return { kind: 'skip', rule: 'bib-authors', descend: false }
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
