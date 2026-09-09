import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import {
  PROTECT_RULES, RULES_VERSION, SKIP_RULES, TABLE_RULES, UNIT_RULES,
  classify, documentRoot, hasTranslatableText, isNamedTag, isNumericCell, visibleText,
} from '@/core/rules/latexml'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

/** Parse a minimal handwritten fragment matching real fixture structure and return the target, defaulting to the first body child */
function el(html: string, selector?: string): Element {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html')
  const target = selector ? doc.querySelector(selector) : doc.body.firstElementChild
  if (!target) throw new Error(`Fragment does not contain ${selector ?? 'a first element'}`)
  return target
}

describe('rule-table integrity', () => {
  const all = [...UNIT_RULES, ...SKIP_RULES, ...PROTECT_RULES]

  it('IDs are unique across tables', () => {
    const ids = all.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every selector is accepted by matches', () => {
    const probe = document.createElement('div')
    for (const r of all) expect(() => probe.matches(r.selector), r.id).not.toThrow()
    expect(() => probe.matches(TABLE_RULES.root)).not.toThrow()
    expect(() => probe.matches(TABLE_RULES.cell)).not.toThrow()
  })

  it('increments the version with this rule change', () => {
    expect(RULES_VERSION).toBe('0.10.0')
  })
})

describe('classify: individual rule matches', () => {
  type Expected = { kind: string; rule: string; descend: boolean } | null
  const cases: [string, string, string | undefined, Expected][] = [
    ['body paragraph', '<div class="ltx_para"><p class="ltx_p">Text.</p></div>', 'p', { kind: 'unit', rule: 'p', descend: true }],
    ['heading with section number', '<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">1 </span>Intro</h2>', 'h2', { kind: 'unit', rule: 'title', descend: true }],
    ['subtitle', '<div class="ltx_subtitle">(Extended)</div>', undefined, { kind: 'unit', rule: 'title', descend: true }],
    ['caption', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table"><span class="ltx_text">Table 1</span>: </span>Results.</figcaption>', undefined, { kind: 'unit', rule: 'caption', descend: true }],
    ['footnote body', '<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>Note.</span></span></span>', '.ltx_note_content', { kind: 'unit', rule: 'footnote', descend: true }],
    // Segmented entries do not form container blocks; each ltx_bibblock is a unit (§5.4).
    ['segmented bibliography entry', '<li class="ltx_bibitem"><span class="ltx_tag ltx_tag_bibitem">[1]</span><span class="ltx_bibblock">A. Title.</span></li>', 'li', null],
    ['bibliography segment', '<li class="ltx_bibitem"><span class="ltx_bibblock">A. Title.</span></li>', '.ltx_bibblock', { kind: 'unit', rule: 'bibblock', descend: true }],
    // The first segment is an author list identified by position; only some templates provide ltx_bib_author.
    ['bibliography author segment (translated since 2026-09-06, §5.4)', '<li class="ltx_bibitem"><span class="ltx_tag">[1]</span><span class="ltx_bibblock">B. P. Abbott et al.</span><span class="ltx_bibblock">Title.</span></li>', '.ltx_bibblock', { kind: 'unit', rule: 'bibblock', descend: true }],
    ['single-segment entry is not author-only', '<li class="ltx_bibitem"><span class="ltx_tag">[1]</span><span class="ltx_bibblock">B. P. Abbott et al. Title. 2024.</span></li>', '.ltx_bibblock', { kind: 'unit', rule: 'bibblock', descend: true }],
    ['unsegmented bibliography entry', '<li class="ltx_bibitem"><span class="ltx_tag ltx_tag_bibitem">[1]</span>A. Title, 2024.</li>', 'li', { kind: 'unit', rule: 'bibitem', descend: true }],
    ['acknowledgements', '<div class="ltx_acknowledgements">Thanks.</div>', undefined, { kind: 'unit', rule: 'ack', descend: true }],
    // Acknowledgement and keyword run-in headings translate with their block, avoiding a separately cloned English heading.
    ['acknowledgement run-in heading', '<div class="ltx_acknowledgements"><h6 class="ltx_title ltx_title_acknowledgements">Acknowledgements.</h6>Text.</div>', 'h6', null],
    ['keyword run-in heading', '<div class="ltx_keywords"><h6 class="ltx_title ltx_title_keywords">Keywords.</h6>a, b</div>', 'h6', null],
    ['keywords', '<div class="ltx_keywords">data races</div>', undefined, { kind: 'unit', rule: 'keywords', descend: true }],
    ['table root', '<table class="ltx_tabular"><tbody><tr><th class="ltx_td ltx_th">h</th><td class="ltx_td">1</td></tr></tbody></table>', undefined, { kind: 'table', rule: 'table', descend: false }],
    ['display equation', '<table class="ltx_equation"><tbody><tr><td class="ltx_td ltx_eqn_cell"><math class="ltx_Math"><mi>x</mi></math></td></tr></tbody></table>', undefined, { kind: 'skip', rule: 'equation', descend: false }],
    ['code line', '<div class="ltx_listing"><div class="ltx_listingline"><span class="ltx_text ltx_font_typewriter">x = 1</span></div></div>', '.ltx_listingline', { kind: 'skip', rule: 'listing', descend: false }],
    ['author names also translate (§5.2, 2026-09-06)', '<div class="ltx_authors"><span class="ltx_creator"><span class="ltx_personname">A. B.</span></span></div>', '.ltx_personname', { kind: 'unit', rule: 'personname', descend: true }],
    ['skip conjunctions between names to avoid breaking the list', '<div class="ltx_authors"><span class="ltx_author_before"> and </span></div>', '.ltx_author_before', { kind: 'skip', rule: 'author-glue', descend: false }],
    ['contact labels are void: template-generated and hidden by site CSS (§5.2)', '<div class="ltx_authors"><span class="ltx_contact ltx_role_email"><span class="ltx_contact_name">Email: </span></span></div>', '.ltx_contact_name', { kind: 'protect', rule: 'contact-label', descend: false }],
    ['author affiliation and contact information', '<span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation: </span>Radboud University</span>', '.ltx_contact', { kind: 'unit', rule: 'authorinfo', descend: true }],
    ['email address', '<span class="ltx_contact ltx_role_email"><a href="mailto:a@b.c">a@b.c</a></span>', 'a', { kind: 'protect', rule: 'mailto', descend: false }],
    ['conjunctions between authors', '<span class="ltx_author_before"> and </span>', undefined, { kind: 'skip', rule: 'author-glue', descend: false }],
    ['date', '<div class="ltx_dates">2018</div>', undefined, { kind: 'unit', rule: 'authorinfo', descend: true }],
    ['classification code', '<div class="ltx_classification">Primary: 11L07</div>', undefined, { kind: 'skip', rule: 'classification', descend: false }],
    ['publication metadata', '<span class="ltx_pubnotes ltx_pubnotes_meta"><span class="ltx_pubnote ltx_role_doi">DOI</span></span>', undefined, { kind: 'skip', rule: 'pubnotes', descend: false }],
    ['TikZ graphic', '<svg class="ltx_picture"><foreignObject><span class="ltx_foreignobject_content">t</span></foreignObject></svg>', undefined, { kind: 'skip', rule: 'picture', descend: false }],
    ['conversion error', '<p class="ltx_p"><span class="ltx_ERROR undefined">\\foo</span></p>', '.ltx_ERROR', { kind: 'skip', rule: 'error', descend: false }],
    ['navigation', '<nav class="ltx_page_navbar"><nav class="ltx_TOC">toc</nav></nav>', undefined, { kind: 'skip', rule: 'nav', descend: false }],
    ['inline formula', '<p class="ltx_p"><math class="ltx_Math"><mi>x</mi></math></p>', 'math', { kind: 'protect', rule: 'math', descend: false }],
    ['cross-reference', '<p class="ltx_p"><a class="ltx_ref"><span class="ltx_text ltx_ref_tag">2</span></a></p>', 'a', { kind: 'protect', rule: 'ref', descend: false }],
    ['citation', '<p class="ltx_p"><cite class="ltx_cite ltx_citemacro_cite">[3]</cite></p>', 'cite', { kind: 'protect', rule: 'cite', descend: false }],
    ['numbering label', '<span class="ltx_tag ltx_tag_item">•</span>', undefined, { kind: 'protect', rule: 'tag', descend: false }],
    ['monospace text', '<span class="ltx_text ltx_font_typewriter">foo</span>', undefined, { kind: 'protect', rule: 'tt', descend: false }],
    ['footnote container: protect-but-descend', '<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup></span>', undefined, { kind: 'protect', rule: 'note', descend: true }],
    ['footnote marker', '<sup class="ltx_note_mark">1</sup>', undefined, { kind: 'protect', rule: 'note-mark', descend: false }],
    ['footnote type', '<span class="ltx_note_type">footnotemark: </span>', undefined, { kind: 'protect', rule: 'note-mark', descend: false }],
    ['image', '<img class="ltx_graphics" alt="">', undefined, { kind: 'protect', rule: 'img', descend: false }],
    ['line break', '<br class="ltx_break">', undefined, { kind: 'protect', rule: 'br', descend: false }],
  ]
  for (const [name, html, selector, expected] of cases) {
    it(name, () => {
      expect(classify(el(html, selector))).toEqual(expected)
    })
  }

  it('ordinary containers and styled spans do not match', () => {
    expect(classify(el('<div class="ltx_para"><p class="ltx_p">x</p></div>'))).toBeNull()
    expect(classify(el('<span class="ltx_text ltx_font_italic">x</span>'))).toBeNull()
    expect(classify(el('<section class="ltx_section"></section>'))).toBeNull()
  })
})

describe('translates named environment tags but preserves pure labels (§5.2; reported untranslated Definition 1.1)', () => {
    // LaTeXML also puts theorem, figure, table, algorithm, and appendix names in ltx_tag. Protecting the whole tag as numbering
    // would leave Definition 1.1 untranslated for Chinese readers. This is based on 1,241 tags across 12 fixtures.
    const tagOf = (html: string) => classify(el(html, '.ltx_tag'))
    const named: [string, string][] = [
      ['theorem', '<h6 class="ltx_title ltx_title_theorem"><span class="ltx_tag ltx_tag_theorem">Definition 1.1</span>.</h6>'],
      ['figure', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 1.</span> Cap.</figcaption>'],
      ['table', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 1:</span> Cap.</figcaption>'],
      ['algorithm', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_float">Algorithm 1</span> Cap.</figcaption>'],
      ['appendix', '<h2 class="ltx_title ltx_title_appendix"><span class="ltx_tag ltx_tag_appendix">Appendix A</span> More</h2>'],
      ['part', '<h1 class="ltx_title"><span class="ltx_tag ltx_tag_part">Part 1</span> X</h1>'],
      ['chapter', '<h1 class="ltx_title"><span class="ltx_tag ltx_tag_chapter">Chapter 1</span> X</h1>'],
    ]
    for (const [name, html] of named) {
      it(`${name} tag is not void because it contains an environment name`, () => {
        expect(tagOf(html)).toBeNull()
      })
    }

    // Roman-numbered tags stay void: machine translation localizes IV as a Chinese numeral, breaking agreement with protected ltx_ref text.
    const roman: [string, string][] = [
      ['Roman-numbered table', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table IV:</span> Cap.</figcaption>'],
      ['Roman-numbered part', '<h1 class="ltx_title"><span class="ltx_tag ltx_tag_part">Part I</span> X</h1>'],
    ]
    for (const [name, html] of roman) {
      it(`${name} remains void`, () => {
        expect(tagOf(html)).toMatchObject({ kind: 'protect', rule: 'tag' })
      })
    }

    const numbered: [string, string][] = [
      ['section number', '<h2 class="ltx_title"><span class="ltx_tag ltx_tag_section">II</span> Intro</h2>'],
      ['subsection number', '<h3 class="ltx_title"><span class="ltx_tag ltx_tag_subsection">II.1</span> Sub</h3>'],
      ['equation number', '<td class="ltx_eqn_cell"><span class="ltx_tag ltx_tag_equation">(1.1)</span></td>'],
      ['list marker', '<li class="ltx_item"><span class="ltx_tag ltx_tag_item">•</span><div class="ltx_para"><p class="ltx_p">x</p></div></li>'],
      ['footnote marker', '<span class="ltx_note"><span class="ltx_tag ltx_tag_note">1</span></span>'],
      ['generic tag', '<li class="ltx_bibitem"><span class="ltx_tag">[1]</span></li>'],
    ]
    for (const [name, html] of numbered) {
      it(`${name} remains void because translating pure numbering would corrupt it`, () => {
        expect(tagOf(html)).toMatchObject({ kind: 'protect', rule: 'tag' })
      })
    }

    // class alone is insufficient because subfigure panel labels also use ltx_tag_figure but contain only identifiers (Codex #53)
    const panels: [string, string][] = [
      ['subfigure panel (a)', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">(a)</span></figcaption>'],
      ['subfigure panel (b)', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">(b)</span></figcaption>'],
      ['numeric-only theorem tag', '<h6 class="ltx_title"><span class="ltx_tag ltx_tag_theorem">1.1</span></h6>'],
    ]
    for (const [name, html] of panels) {
      it(`${name} remains void to preserve panel correspondence`, () => {
        expect(tagOf(html)).toMatchObject({ kind: 'protect', rule: 'tag' })
      })
    }

    it('parenthesized identifiers are not words; panel labels may be multiletter Roman numerals (Codex #53)', () => {
      for (const label of ['(a)', '(ii)', '(iii)', '(iv)', '（乙）', '(A.1)']) {
        expect([label, isNamedTag(el(`<span class="ltx_tag ltx_tag_figure">${label}</span>`))]).toEqual([label, false])
      }
      // Environment names are not parenthesized; words remaining after removing parentheses still translate.
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_theorem">Definition 1.2 (Hall set)</span>'))).toBe(true)
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_figure">Figure 3 (a)</span>'))).toBe(true)
    })

    it('Roman-numbered tags remain untranslated because localized numerals would disagree with protected ltx_ref text', () => {
      // google-gtx measurements on 2026-09-05 localized the Roman numerals in Table IV, Table X, and Part I into Chinese numerals.
      for (const text of ['Table I:', 'Table IV:', 'Table X:', 'Table XIII:', 'Part I', 'Appendix V', 'Table IV.1:', 'Theorem IV-A', 'Lemma II.3.', 'Table iv:', 'Theorem ii.3', 'Part i', 'Table IV :', 'Theorem II .', '(Table IV)']) {
        expect([text, isNamedTag(el(`<span class="ltx_tag ltx_tag_table">${text}</span>`))]).toEqual([text, false])
      }
      // Arabic-numbered and lettered labels stayed unchanged in testing, so their environment names can translate.
      for (const text of ['Table 4:', 'Appendix A', 'Appendix C', 'Appendix D', 'Definition 1.1.', 'Corollary A.3.', 'Appendix A.1', 'Lemma D.2', '(Figure 1)', '(Theorem 2)', 'Definition 1 (Hall set)']) {
        expect([text, isNamedTag(el(`<span class="ltx_tag ltx_tag_table">${text}</span>`))]).toEqual([text, true])
      }
    })

    it('requires two consecutive letters; single-letter identifiers are not words', () => {
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_figure">Figure 1.</span>'))).toBe(true)
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_figure">(a)</span>'))).toBe(false)
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_figure">(1)</span>'))).toBe(false)
      // unlisted classes remain untranslated even when they contain words
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_section">Appendix</span>'))).toBe(false)
    })
  })

describe('classify priority: skip > table > unit > protect', () => {
  it('skip takes precedence over unit', () => {
    expect(classify(el('<p class="ltx_p ltx_ERROR">x</p>'))?.kind).toBe('skip')
  })
  it('table takes precedence over unit', () => {
    expect(classify(el('<table class="ltx_tabular ltx_p"></table>'))?.kind).toBe('table')
  })
  it('unit takes precedence over protect', () => {
    expect(classify(el('<span class="ltx_p ltx_ref">x</span>'))?.kind).toBe('unit')
  })
  it('skip takes precedence over protect', () => {
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

  it('prunes protect and skip subtrees, including descend-enabled footnote containers', () => {
    const t = visibleText(para())
    expect(t).toContain('Let ')
    expect(t).toContain(' be a graph; see ')
    expect(t).toContain(' Done.')
    expect(t).not.toContain('α')
    expect(t).not.toContain('alpha')
    expect(t).not.toContain('Section 2')
    expect(t).not.toContain('Footnote body')
  })

  it('preserves thin spaces around formulas without trimming internal whitespace', () => {
    expect(visibleText(el('<p class="ltx_p">a\u2009<math class="ltx_Math"><mi>x</mi></math>\u2009b</p>'))).toBe('a\u2009\u2009b')
  })

  it('paragraphs containing only formulas, numbers, or punctuation have no translatable text', () => {
    expect(hasTranslatableText(el('<p class="ltx_p"><math class="ltx_Math"><mi>x</mi></math> = 1.</p>'))).toBe(false)
    expect(hasTranslatableText(el('<p class="ltx_p">12.5 (3)</p>'))).toBe(false)
    expect(hasTranslatableText(el('<p class="ltx_p">   </p>'))).toBe(false)
  })

  it('any Unicode letter counts as translatable', () => {
    expect(hasTranslatableText(para())).toBe(true)
    expect(hasTranslatableText(el('<p class="ltx_p">证明。</p>'))).toBe(true)
    expect(hasTranslatableText(el('<p class="ltx_p">λ</p>'))).toBe(true)
  })
})

describe('isNumericCell: Phase 0 calibrated boundary cases', () => {
  const numeric = ['7.7 GeV', '±0.3', '12,345', '1e-5', '3 × 10^4', '0.92 ± 0.01', '(3)', '✓', '—', 'N/A', '']
  const prose = ['ERROR', 'Esp', 'TRUE', 'Total', '(kpc)', 'Au+Au', 'Disk crossing', 'e']
  for (const t of numeric) it(`numeric cell: ${JSON.stringify(t)}`, () => expect(isNumericCell(t)).toBe(true))
  for (const t of prose) it(`prose cell: ${JSON.stringify(t)}`, () => expect(isNumericCell(t)).toBe(false))
})

describe('fixture invariants', () => {
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  /** Synthetic fixture covers template structures absent from real papers (RESEARCH.md §2.12) */
  const SYNTHETIC = 'synthetic-structures.html'

  it('contains 12 real papers and one synthetic fixture', () => {
    expect(files.filter(f => f !== SYNTHETIC)).toHaveLength(12)
    expect(files).toContain(SYNTHETIC)
  })

  for (const f of files) {
    it(`${f}: translation root exists, unit rules are exclusive, and classify does not throw`, () => {
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

  it('returns null without a translation root', () => {
    expect(documentRoot(new DOMParser().parseFromString('<html><body></body></html>', 'text/html'))).toBeNull()
  })

  it('returns the supplied element when it is itself the root because querySelector searches descendants only (Codex #2 / #3)', () => {
    const doc = new DOMParser().parseFromString('<html><body><article class="ltx_document"><p class="ltx_p">x</p></article></body></html>', 'text/html')
    const article = doc.querySelector('article')!
    expect(documentRoot(article)).toBe(article)
    expect(documentRoot(doc.querySelector('p')!)).toBeNull()
  })
})

describe('description-list terms (Codex #18)', () => {
  const doc = (html: string) => new DOMParser().parseFromString(`<!doctype html><html><body><article class="ltx_document">${html}</article></body></html>`, 'text/html')
  const item = (tagText: string) =>
    `<dl class="ltx_description"><dt class="ltx_item"><span class="ltx_tag ltx_tag_item">${tagText}</span></dt></dl>`

  it('terms containing words translate; otherwise ltx_item would have no own text and form no block', () => {
    const d = doc(item('Compactness.'))
    const blocks = extract(d)
    expect(blocks.map(b => b.unit)).toEqual(['item'])
    expect(classify(d.querySelector('.ltx_tag_item')!)).toBeNull()
  })

  it('pure bullet and numeric markers remain void and untranslated', () => {
    for (const marker of ['•', '(1)', '2.', '(ii)']) {
      const d = doc(item(marker))
      expect([marker, extract(d).length]).toEqual([marker, 0])
      expect([marker, classify(d.querySelector('.ltx_tag_item')!)?.rule]).toEqual([marker, 'tag'])
    }
  })
})

describe('every bibliography segment translates, including author segments (§5.4, 2026-09-06)', () => {
  const entry = (inner: string) => new DOMParser()
    .parseFromString(`<!doctype html><html><body><article class="ltx_document"><ul class="ltx_biblist"><li class="ltx_bibitem">${inner}</li></ul></article></body></html>`, 'text/html')

  it('author segments marked ltx_bib_author are translation units', () => {
    const d = entry('<span class="ltx_bibblock"><span class="ltx_bib_author">Doe, J.</span></span><span class="ltx_bibblock">A Title.</span>')
    for (const el of d.querySelectorAll('.ltx_bibblock')) expect(classify(el)).toEqual({ kind: 'unit', rule: 'bibblock', descend: true })
  })

  it('unmarked first segments identified by position are also translation units', () => {
    const d = entry('<span class="ltx_bibblock">Doe, J., and Roe, R.</span><span class="ltx_bibblock">A Title.</span>')
    for (const el of d.querySelectorAll('.ltx_bibblock')) expect(classify(el)).toEqual({ kind: 'unit', rule: 'bibblock', descend: true })
  })

  it('citation years remain void and outside translatable text (Codex #74)', () => {
    const d = entry('<span class="ltx_bibblock"><span class="ltx_bib_author">Doe, J.</span><span class="ltx_text ltx_bib_year"> (2024)</span></span>')
    const year = d.querySelector('.ltx_bib_year')!
    expect(classify(year)).toEqual({ kind: 'protect', rule: 'bib-year', descend: false })
    // The whole segment is still a unit: author names translate while years remain placeholders.
    expect(classify(d.querySelector('.ltx_bibblock')!)).toEqual({ kind: 'unit', rule: 'bibblock', descend: true })
  })

  it('templates with a full citation first and DOI second translate both segments (2609.03896, user report)', () => {
    // The old positional rule failed especially badly here by skipping the entire first segment as an author list,
    // leaving the whole citation untranslated while only the DOI line acquired Chinese punctuation.
    const d = entry('<span class="ltx_bibblock">T. M. Apostol, <em class="ltx_emph">Introduction to Analytic Number Theory</em>, Undergraduate Texts in Mathematics, Springer, New York, 1976.</span>'
      + '<span class="ltx_bibblock">doi: <a class="ltx_ref ltx_href" href="https://doi.org/10.1007/978-1-4757-5579-4">10.1007/978-1-4757-5579-4</a>.</span>')
    for (const el of d.querySelectorAll('.ltx_bibblock')) expect(classify(el)).toEqual({ kind: 'unit', rule: 'bibblock', descend: true })
  })

  it('single-segment entries remain whole-entry units with unchanged behavior', () => {
    const d = entry('<span class="ltx_bibblock">Doe, J. A Title. Journal, 2020.</span>')
    expect(classify(d.querySelector('.ltx_bibblock')!)).toEqual({ kind: 'unit', rule: 'bibblock', descend: true })
  })
})
