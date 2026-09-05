import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PROTECT_RULES, RULES_VERSION, SKIP_RULES, TABLE_RULES, UNIT_RULES,
  classify, documentRoot, hasTranslatableText, isNumericCell, visibleText,
} from '@/core/rules/latexml'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

/** 解析一个按 fixture 真实结构手写的最小片段，返回目标元素（默认 body 的第一个子元素） */
function el(html: string, selector?: string): Element {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html')
  const target = selector ? doc.querySelector(selector) : doc.body.firstElementChild
  if (!target) throw new Error(`片段中找不到 ${selector ?? '首个元素'}`)
  return target
}

describe('规则表完整性', () => {
  const all = [...UNIT_RULES, ...SKIP_RULES, ...PROTECT_RULES]

  it('id 跨表唯一', () => {
    const ids = all.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条 selector 都能被 matches 接受', () => {
    const probe = document.createElement('div')
    for (const r of all) expect(() => probe.matches(r.selector), r.id).not.toThrow()
    expect(() => probe.matches(TABLE_RULES.root)).not.toThrow()
    expect(() => probe.matches(TABLE_RULES.cell)).not.toThrow()
  })

  it('版本号随本次规则变化升级', () => {
    expect(RULES_VERSION).toBe('0.6.1')
  })
})

describe('classify：逐规则命中', () => {
  type Expected = { kind: string; rule: string; descend: boolean } | null
  const cases: [string, string, string | undefined, Expected][] = [
    ['正文段落', '<div class="ltx_para"><p class="ltx_p">Text.</p></div>', 'p', { kind: 'unit', rule: 'p', descend: true }],
    ['标题（含章节号）', '<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">1 </span>Intro</h2>', 'h2', { kind: 'unit', rule: 'title', descend: true }],
    ['副标题', '<div class="ltx_subtitle">(Extended)</div>', undefined, { kind: 'unit', rule: 'title', descend: true }],
    ['图注', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table"><span class="ltx_text">Table 1</span>: </span>Results.</figcaption>', undefined, { kind: 'unit', rule: 'caption', descend: true }],
    ['脚注正文', '<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>Note.</span></span></span>', '.ltx_note_content', { kind: 'unit', rule: 'footnote', descend: true }],
    // 分段的条目：容器本身不成块，逐个 .ltx_bibblock 才是单元（§5.4）
    ['参考文献条目（分段）', '<li class="ltx_bibitem"><span class="ltx_tag ltx_tag_bibitem">[1]</span><span class="ltx_bibblock">A. Title.</span></li>', 'li', null],
    ['参考文献片段', '<li class="ltx_bibitem"><span class="ltx_bibblock">A. Title.</span></li>', '.ltx_bibblock', { kind: 'unit', rule: 'bibblock', descend: true }],
    // 多段条目的第一段是作者列表，按位置判断（部分模板才有 .ltx_bib_author）
    ['参考文献的作者段', '<li class="ltx_bibitem"><span class="ltx_tag">[1]</span><span class="ltx_bibblock">B. P. Abbott et al.</span><span class="ltx_bibblock">Title.</span></li>', '.ltx_bibblock', { kind: 'skip', rule: 'bib-authors', descend: false }],
    ['只有一段的条目不当作者段', '<li class="ltx_bibitem"><span class="ltx_tag">[1]</span><span class="ltx_bibblock">B. P. Abbott et al. Title. 2024.</span></li>', '.ltx_bibblock', { kind: 'unit', rule: 'bibblock', descend: true }],
    ['未分段的参考文献条目', '<li class="ltx_bibitem"><span class="ltx_tag ltx_tag_bibitem">[1]</span>A. Title, 2024.</li>', 'li', { kind: 'unit', rule: 'bibitem', descend: true }],
    ['致谢', '<div class="ltx_acknowledgements">Thanks.</div>', undefined, { kind: 'unit', rule: 'ack', descend: true }],
    // 致谢 / 关键词的 run-in 标题随所在块一起翻，不单独成块（否则外层块会克隆一份英文标题）
    ['致谢的 run-in 标题', '<div class="ltx_acknowledgements"><h6 class="ltx_title ltx_title_acknowledgements">Acknowledgements.</h6>Text.</div>', 'h6', null],
    ['关键词的 run-in 标题', '<div class="ltx_keywords"><h6 class="ltx_title ltx_title_keywords">Keywords.</h6>a, b</div>', 'h6', null],
    ['关键词', '<div class="ltx_keywords">data races</div>', undefined, { kind: 'unit', rule: 'keywords', descend: true }],
    ['表格根', '<table class="ltx_tabular"><tbody><tr><th class="ltx_td ltx_th">h</th><td class="ltx_td">1</td></tr></tbody></table>', undefined, { kind: 'table', rule: 'table', descend: false }],
    ['行间公式', '<table class="ltx_equation"><tbody><tr><td class="ltx_td ltx_eqn_cell"><math class="ltx_Math"><mi>x</mi></math></td></tr></tbody></table>', undefined, { kind: 'skip', rule: 'equation', descend: false }],
    ['代码行', '<div class="ltx_listing"><div class="ltx_listingline"><span class="ltx_text ltx_font_typewriter">x = 1</span></div></div>', '.ltx_listingline', { kind: 'skip', rule: 'listing', descend: false }],
    ['作者姓名', '<div class="ltx_authors"><span class="ltx_creator"><span class="ltx_personname">A. B.</span></span></div>', '.ltx_personname', { kind: 'skip', rule: 'personname', descend: false }],
    ['作者的机构与联系方式', '<span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation: </span>Radboud University</span>', '.ltx_contact', { kind: 'unit', rule: 'authorinfo', descend: true }],
    ['邮箱地址', '<span class="ltx_contact ltx_role_email"><a href="mailto:a@b.c">a@b.c</a></span>', 'a', { kind: 'protect', rule: 'mailto', descend: false }],
    ['作者之间的连接词', '<span class="ltx_author_before"> and </span>', undefined, { kind: 'skip', rule: 'author-glue', descend: false }],
    ['日期', '<div class="ltx_dates">2018</div>', undefined, { kind: 'unit', rule: 'authorinfo', descend: true }],
    ['分类号', '<div class="ltx_classification">Primary: 11L07</div>', undefined, { kind: 'skip', rule: 'classification', descend: false }],
    ['出版元数据', '<span class="ltx_pubnotes ltx_pubnotes_meta"><span class="ltx_pubnote ltx_role_doi">DOI</span></span>', undefined, { kind: 'skip', rule: 'pubnotes', descend: false }],
    ['TikZ 图', '<svg class="ltx_picture"><foreignObject><span class="ltx_foreignobject_content">t</span></foreignObject></svg>', undefined, { kind: 'skip', rule: 'picture', descend: false }],
    ['转换错误', '<p class="ltx_p"><span class="ltx_ERROR undefined">\\foo</span></p>', '.ltx_ERROR', { kind: 'skip', rule: 'error', descend: false }],
    ['导航栏', '<nav class="ltx_page_navbar"><nav class="ltx_TOC">toc</nav></nav>', undefined, { kind: 'skip', rule: 'nav', descend: false }],
    ['行内公式', '<p class="ltx_p"><math class="ltx_Math"><mi>x</mi></math></p>', 'math', { kind: 'protect', rule: 'math', descend: false }],
    ['交叉引用', '<p class="ltx_p"><a class="ltx_ref"><span class="ltx_text ltx_ref_tag">2</span></a></p>', 'a', { kind: 'protect', rule: 'ref', descend: false }],
    ['引用', '<p class="ltx_p"><cite class="ltx_cite ltx_citemacro_cite">[3]</cite></p>', 'cite', { kind: 'protect', rule: 'cite', descend: false }],
    ['编号标签', '<span class="ltx_tag ltx_tag_item">•</span>', undefined, { kind: 'protect', rule: 'tag', descend: false }],
    ['等宽文本', '<span class="ltx_text ltx_font_typewriter">foo</span>', undefined, { kind: 'protect', rule: 'tt', descend: false }],
    ['脚注容器：protect-but-descend', '<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup></span>', undefined, { kind: 'protect', rule: 'note', descend: true }],
    ['脚注标记', '<sup class="ltx_note_mark">1</sup>', undefined, { kind: 'protect', rule: 'note-mark', descend: false }],
    ['脚注类型', '<span class="ltx_note_type">footnotemark: </span>', undefined, { kind: 'protect', rule: 'note-mark', descend: false }],
    ['图片', '<img class="ltx_graphics" alt="">', undefined, { kind: 'protect', rule: 'img', descend: false }],
    ['换行', '<br class="ltx_break">', undefined, { kind: 'protect', rule: 'br', descend: false }],
  ]
  for (const [name, html, selector, expected] of cases) {
    it(name, () => {
      expect(classify(el(html, selector))).toEqual(expected)
    })
  }

  it('普通容器与样式 span 不命中', () => {
    expect(classify(el('<div class="ltx_para"><p class="ltx_p">x</p></div>'))).toBeNull()
    expect(classify(el('<span class="ltx_text ltx_font_italic">x</span>'))).toBeNull()
    expect(classify(el('<section class="ltx_section"></section>'))).toBeNull()
  })
})

describe('带环境名的 tag 要翻译，纯编号的不翻（§5.2，用户反馈 Definition 1.1 没被翻）', () => {
    // LaTeXML 把定理环境、图表、算法、附录的名字也放进 .ltx_tag：整体当编号保护的话，
    // 中文读者看到的还是「Definition 1.1.」。依据是 12 篇 fixture 里 1241 个 tag 的实测分布
    const tagOf = (html: string) => classify(el(html, '.ltx_tag'))
    const named: [string, string][] = [
      ['定理', '<h6 class="ltx_title ltx_title_theorem"><span class="ltx_tag ltx_tag_theorem">Definition 1.1</span>.</h6>'],
      ['插图', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 1.</span> Cap.</figcaption>'],
      ['表格', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 1:</span> Cap.</figcaption>'],
      ['算法', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_float">Algorithm 1</span> Cap.</figcaption>'],
      ['附录', '<h2 class="ltx_title ltx_title_appendix"><span class="ltx_tag ltx_tag_appendix">Appendix A</span> More</h2>'],
      ['部分', '<h1 class="ltx_title"><span class="ltx_tag ltx_tag_part">Part I</span> X</h1>'],
      ['章', '<h1 class="ltx_title"><span class="ltx_tag ltx_tag_chapter">Chapter 1</span> X</h1>'],
    ]
    for (const [name, html] of named) {
      it(`${name}的 tag 不再是 void：里面有环境名`, () => {
        expect(tagOf(html)).toBeNull()
      })
    }

    const numbered: [string, string][] = [
      ['章节号', '<h2 class="ltx_title"><span class="ltx_tag ltx_tag_section">II</span> Intro</h2>'],
      ['小节号', '<h3 class="ltx_title"><span class="ltx_tag ltx_tag_subsection">II.1</span> Sub</h3>'],
      ['公式号', '<td class="ltx_eqn_cell"><span class="ltx_tag ltx_tag_equation">(1.1)</span></td>'],
      ['列表符号', '<li class="ltx_item"><span class="ltx_tag ltx_tag_item">•</span><div class="ltx_para"><p class="ltx_p">x</p></div></li>'],
      ['脚注标记', '<span class="ltx_note"><span class="ltx_tag ltx_tag_note">1</span></span>'],
      ['无细分的 tag', '<li class="ltx_bibitem"><span class="ltx_tag">[1]</span></li>'],
    ]
    for (const [name, html] of numbered) {
      it(`${name}仍作 void：纯编号翻了只会坏事`, () => {
        expect(tagOf(html)).toMatchObject({ kind: 'protect', rule: 'tag' })
      })
    }
  })

describe('classify：优先级 skip > table > unit > protect', () => {
  it('skip 胜 unit', () => {
    expect(classify(el('<p class="ltx_p ltx_ERROR">x</p>'))?.kind).toBe('skip')
  })
  it('table 胜 unit', () => {
    expect(classify(el('<table class="ltx_tabular ltx_p"></table>'))?.kind).toBe('table')
  })
  it('unit 胜 protect', () => {
    expect(classify(el('<span class="ltx_p ltx_ref">x</span>'))?.kind).toBe('unit')
  })
  it('skip 胜 protect', () => {
    expect(classify(el('<span class="ltx_ERROR ltx_ref">x</span>'))?.kind).toBe('skip')
  })
})

describe('visibleText / hasTranslatableText', () => {
  const para = () => el(
    '<p class="ltx_p">Let <math class="ltx_Math" alttext="\\alpha"><semantics><mi>α</mi>'
    + '<annotation encoding="application/x-tex">\\alpha</annotation></semantics></math> be a graph; see '
    + '<a class="ltx_ref"><span class="ltx_text ltx_ref_tag">Section 2</span></a>.'
    + '<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer">'
    + '<span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>Footnote body.</span></span></span> Done.</p>',
  )

  it('剪掉 protect / skip 子树，包括 descend 的脚注容器', () => {
    const t = visibleText(para())
    expect(t).toContain('Let ')
    expect(t).toContain(' be a graph; see ')
    expect(t).toContain(' Done.')
    expect(t).not.toContain('α')
    expect(t).not.toContain('alpha')
    expect(t).not.toContain('Section 2')
    expect(t).not.toContain('Footnote body')
  })

  it('保留公式两侧的细空格，不 trim 内部空白', () => {
    expect(visibleText(el('<p class="ltx_p">a\u2009<math class="ltx_Math"><mi>x</mi></math>\u2009b</p>'))).toBe('a\u2009\u2009b')
  })

  it('只含公式、数字或标点的段落没有可翻译文本', () => {
    expect(hasTranslatableText(el('<p class="ltx_p"><math class="ltx_Math"><mi>x</mi></math> = 1.</p>'))).toBe(false)
    expect(hasTranslatableText(el('<p class="ltx_p">12.5 (3)</p>'))).toBe(false)
    expect(hasTranslatableText(el('<p class="ltx_p">   </p>'))).toBe(false)
  })

  it('任何 Unicode 字母都算可翻译', () => {
    expect(hasTranslatableText(para())).toBe(true)
    expect(hasTranslatableText(el('<p class="ltx_p">证明。</p>'))).toBe(true)
    expect(hasTranslatableText(el('<p class="ltx_p">λ</p>'))).toBe(true)
  })
})

describe('isNumericCell（Phase 0 校准边界用例）', () => {
  const numeric = ['7.7 GeV', '±0.3', '12,345', '1e-5', '3 × 10^4', '0.92 ± 0.01', '(3)', '✓', '—', 'N/A', '']
  const prose = ['ERROR', 'Esp', 'TRUE', 'Total', '(kpc)', 'Au+Au', 'Disk crossing', 'e']
  for (const t of numeric) it(`数值格：${JSON.stringify(t)}`, () => expect(isNumericCell(t)).toBe(true))
  for (const t of prose) it(`散文格：${JSON.stringify(t)}`, () => expect(isNumericCell(t)).toBe(false))
})

describe('fixture 不变量', () => {
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  /** 合成结构 fixture：覆盖真实论文里没出现过的模板结构（RESEARCH.md §2.12） */
  const SYNTHETIC = 'synthetic-structures.html'

  it('有 12 篇真实论文 + 1 份合成结构', () => {
    expect(files.filter(f => f !== SYNTHETIC)).toHaveLength(12)
    expect(files).toContain(SYNTHETIC)
  })

  for (const f of files) {
    it(`${f}：翻译根存在，unit 规则互斥，classify 不抛错`, () => {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      const root = documentRoot(doc)
      expect(root).not.toBeNull()
      let multi = 0
      for (const e of Array.from(root!.querySelectorAll('*'))) {
        classify(e)
        if (UNIT_RULES.filter(r => e.matches(r.selector)).length > 1) multi++
      }
      expect(multi).toBe(0)
    })
  }

  it('没有翻译根时返回 null', () => {
    expect(documentRoot(new DOMParser().parseFromString('<html><body></body></html>', 'text/html'))).toBeNull()
  })

  it('传入的元素本身就是翻译根时返回它自己（Codex 在 #2 / #3 指出 querySelector 只搜后代）', () => {
    const doc = new DOMParser().parseFromString('<html><body><article class="ltx_document"><p class="ltx_p">x</p></article></body></html>', 'text/html')
    const article = doc.querySelector('article')!
    expect(documentRoot(article)).toBe(article)
    expect(documentRoot(doc.querySelector('p')!)).toBeNull()
  })
})
