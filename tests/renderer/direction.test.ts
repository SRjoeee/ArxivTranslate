// Right-to-left target languages (§7.1): `lang` says which language, the paragraph's base direction is set by `dir`.
// Without `dir` the translation inherits arXiv's ltr, and final punctuation, digits, Latin words and formulas all sit on the wrong side
// (measured on 2509.10652v3 translated into Arabic: “مساهمات متساوية.” rendered as “مساهمات .متساوية”).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RTL_LANGUAGES, isRtl, isRtlTag, toBcp47 } from '@/config/languages'
import { extract, type TableBlock, type TextBlock } from '@/core/extractor'
import { DIR_ATTR, LANG_ATTR } from '@/core/renderer/attrs'
import { enable } from '@/core/renderer/page'
import { renderTable, renderText } from '@/core/renderer/translation'
import { TABLE_RULES } from '@/core/rules/latexml'
import { docOf, frag } from './helpers'

describe('the RTL language table', () => {
  it('13 right-to-left languages, recognised in both spellings', () => {
    expect(RTL_LANGUAGES.size).toBe(13)
    for (const code of ['arb', 'heb', 'pes', 'urd', 'uig', 'ckb']) {
      expect([code, isRtl(code)]).toEqual([code, true])
      expect([code, isRtlTag(toBcp47(code))]).toEqual([code, true])
    }
    // The three without a two-letter code (sent to the engine as 639-3) must be recognised too
    for (const code of ['prs', 'pbu', 'skr']) expect([code, isRtlTag(toBcp47(code))]).toEqual([code, true])
    for (const code of ['cmn', 'eng', 'jpn', 'rus', 'kmr']) {
      expect([code, isRtl(code)]).toEqual([code, false])
      expect([code, isRtlTag(toBcp47(code))]).toEqual([code, false])
    }
  })

  it('case and region subtags do not affect the verdict', () => {
    expect(isRtlTag('AR')).toBe(true)
    expect(isRtlTag('ar-EG')).toBe(true)
    expect(isRtlTag('zh-Hans')).toBe(false)
  })

  // Codex on #163: the tag sent for zlm is ms-Arab (Jawi), which a check on the primary subtag would miss as ltr;
  // treating ms itself as an RTL primary subtag would misjudge Latin-script Malay as rtl. With a script subtag present it decides
  it('the script subtag decides direction over the primary language: ms-Arab is rtl, ms is not', () => {
    expect(toBcp47('zlm')).toBe('ms-Arab')
    expect(isRtl('zlm')).toBe(true)
    expect(isRtlTag('ms-Arab')).toBe(true)
    expect(isRtlTag('MS-ARAB')).toBe(true)
    expect(isRtlTag('ms')).toBe(false)
    expect(isRtlTag('ms-MY')).toBe(false)
  })

  it('an RTL language in Latin script is ltr, and the reverse holds too', () => {
    expect(isRtlTag('ur-Latn')).toBe(false)
    expect(isRtlTag('ar-Latn-EG')).toBe(false)
    expect(isRtlTag('he-Hebr')).toBe(true)
    // A four-character subtag starting with a digit is a variant, not a script: do not take it for one
    expect(isRtlTag('ar-1901')).toBe(true)
  })
})

describe('the dir of translation nodes', () => {
  const blockOf = (doc: Document) => (extract(doc) as TextBlock[])[0]!

  it('an RTL target: recorded once on <html>, copied onto every translation node', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Equal contributions.</p></div>')
    enable(doc, 'stack', undefined, 'ar')
    expect(doc.documentElement.getAttribute(DIR_ATTR)).toBe('rtl')
    const node = renderText(blockOf(doc), frag(doc, 'مساهمات متساوية.'))
    expect(node.getAttribute('dir')).toBe('rtl')
    expect(node.getAttribute('lang')).toBe('ar')
    // Not one attribute more on the original node (§7.1 allows data-axt-* only)
    expect(blockOf(doc).el.hasAttribute('dir')).toBe(false)
  })

  it('a left-to-right target: no dir written at all', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p></div>')
    enable(doc, 'stack', undefined, 'zh')
    expect(doc.documentElement.hasAttribute(DIR_ATTR)).toBe(false)
    expect(renderText(blockOf(doc), frag(doc, '文本。')).hasAttribute('dir')).toBe(false)
  })

  it('a change of target language moves the mark with it, or a Chinese translation still wears the previous round\'s rtl', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p></div>')
    enable(doc, 'stack', undefined, 'he')
    expect(doc.documentElement.getAttribute(DIR_ATTR)).toBe('rtl')
    enable(doc, 'stack', undefined, 'zh')
    expect(doc.documentElement.hasAttribute(DIR_ATTR)).toBe(false)
    expect(doc.documentElement.getAttribute(LANG_ATTR)).toBe('zh')
  })
})

// Tables go through renderTable, not renderText — on that path both `lang` and `dir` were missing
// (Codex on #163 pointed out `dir`; `lang` is the same hole in the same place: a screen reader would read the table's Chinese in an English voice)
describe('lang / dir of translated table cells', () => {
  const table =
    '<figure class="ltx_table" id="F1"><table class="ltx_tabular" id="T1"><tbody>'
    + '<tr><th class="ltx_td ltx_th" id="h1">Model</th><td class="ltx_td">91.2</td></tr>'
    + '</tbody></table><figcaption class="ltx_caption">Table 1</figcaption></figure>'
  const tableOf = (doc: Document) => extract(doc).find(b => b.kind === 'table') as TableBlock

  it('an RTL target: replaced cells carry dir and lang, the table itself does not — it would flip the column order too', () => {
    const doc = docOf(table)
    enable(doc, 'stack', undefined, 'ar')
    const t = tableOf(doc)
    const node = renderTable(t, new Map([[t.cells[0]!.el, frag(doc, 'نموذج')]]))
    expect(node.hasAttribute('dir')).toBe(false)
    const cells = Array.from(node.querySelectorAll(TABLE_RULES.cell))
    expect(cells[0]!.getAttribute('dir')).toBe('rtl')
    expect(cells[0]!.getAttribute('lang')).toBe('ar')
    // Numeric cells not replaced stay as they were: they still hold the original
    expect(cells[1]!.hasAttribute('dir')).toBe(false)
    expect(cells[1]!.hasAttribute('lang')).toBe(false)
    // Not one attribute more on the original table (§7.1)
    expect(t.cells[0]!.el.hasAttribute('dir')).toBe(false)
    expect(t.cells[0]!.el.hasAttribute('lang')).toBe(false)
  })

  it('an LTR target: lang only, no dir', () => {
    const doc = docOf(table)
    enable(doc, 'stack', undefined, 'zh')
    const t = tableOf(doc)
    const node = renderTable(t, new Map([[t.cells[0]!.el, frag(doc, '模型')]]))
    const cell = node.querySelectorAll(TABLE_RULES.cell)[0]!
    expect(cell.getAttribute('lang')).toBe('zh')
    expect(cell.hasAttribute('dir')).toBe(false)
  })
})

// happy-dom has no bidi algorithm; the rule itself is guarded here (§7.1)
describe('the RTL rules of modes.css', () => {
  const RULES = readFileSync(join(import.meta.dirname, '../../src/styles/modes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('protected source atoms inside an rtl translation are all laid out ltr and isolated from each other', () => {
    const rule = /html\[data-axt-dir="rtl"\] \.axt-t :is\(([^)]*)\) \{([^}]*)\}/.exec(RULES)
    expect(rule).not.toBeNull()
    // Beyond formulas, the source atoms placeholders bring back need it too: inline code, typewriter text, citations, URLs,
    // and the English original inside a margin-note copy (Codex on #163: only formulas were covered before)
    for (const sel of ['math', '.ltx_Math', '.ltx_ref', '.ltx_url', '.ltx_listing', 'code', '.ltx_font_typewriter', '.axt-note-s']) {
      expect([sel, rule![1]!.includes(sel)]).toEqual([sel, true])
    }
    expect(rule![2]).toMatch(/direction:\s*ltr/)
    // Only isolate keeps the neutral characters at the end of `f(x)` from being pulled along by the surrounding rtl
    expect(rule![2]).toMatch(/unicode-bidi:\s*isolate/)
  })
})
