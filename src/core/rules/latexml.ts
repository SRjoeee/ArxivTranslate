// LaTeXML 规则表。所有 ltx_* 选择器只能出现在本文件（CLAUDE.md 硬规则 2）。
// 依据 DESIGN.md §5.1 / §5.2 逐条录入；Phase 0 只放数据，提取函数与测试在 Phase 1 加。
// 实测依据见 docs/RESEARCH.md §2 / §3。

export const RULES_VERSION = '0.1.0-phase0'

/** LaTeXML 类名前缀，用于判断一个元素是否属于论文正文 */
export const LTX_CLASS_PREFIX = 'ltx_'

/** 翻译根：根之外（导航栏、arXiv 注入的页头页脚）一律不提取，见 RESEARCH.md §3.1 */
export const DOCUMENT_ROOT = 'article.ltx_document'

export interface Rule {
  id: string
  selector: string
  note: string
}

/** §5.1 翻译单元 */
export const UNIT_RULES: readonly Rule[] = [
  { id: 'p', selector: '.ltx_p', note: '正文段落；.ltx_para 是带锚点的容器' },
  { id: 'title', selector: '.ltx_title', note: '各级标题，内含 .ltx_tag 章节号' },
  { id: 'abstract', selector: '.ltx_abstract .ltx_p', note: '摘要' },
  { id: 'caption', selector: '.ltx_caption', note: '图表说明，内含 .ltx_tag' },
  { id: 'item', selector: '.ltx_item .ltx_p', note: '列表项内段落' },
  { id: 'note', selector: '.ltx_note_content', note: '脚注正文' },
  { id: 'td', selector: '.ltx_td', note: '表格单元格（含散文的），见 §5.3' },
  { id: 'bibitem', selector: '.ltx_bibitem', note: '参考文献条目，见 §5.4' },
  { id: 'theorem', selector: '.ltx_theorem .ltx_p, .ltx_proof .ltx_p', note: '定理与证明内段落' },
]

/** §5.2 跳过规则：整块不翻；若出现在翻译单元内部则是受保护节点（§6.1） */
export const SKIP_RULES: readonly Rule[] = [
  { id: 'math', selector: 'math, .ltx_Math', note: 'MathML 公式' },
  { id: 'equation', selector: '.ltx_equation, .ltx_equationgroup', note: '行间公式' },
  { id: 'tag', selector: '.ltx_tag', note: '公式编号、章节号、图表号' },
  { id: 'code', selector: '.ltx_listing, .ltx_listingline, .ltx_verbatim, pre, code', note: '代码、算法、verbatim' },
  { id: 'tt', selector: '.ltx_text.ltx_font_typewriter', note: '等宽文本视为代码' },
  { id: 'nav', selector: '.ltx_page_navbar, .ltx_TOC', note: '导航栏与目录（位于翻译根之外）' },
  { id: 'authors', selector: '.ltx_authors, .ltx_author, .ltx_contact, .ltx_date', note: '作者、机构、日期' },
  { id: 'error', selector: '.ltx_ERROR', note: 'LaTeXML 转换错误块' },
]

/** §15.1 图片统计用选择器 */
export const FIGURE_SELECTORS = {
  figure: '.ltx_figure',
  graphics: 'img.ltx_graphics',
} as const
