// Side-layout guards (DESIGN §7.2).
// These test structural coverage, not visual styling, because happy-dom has no layout engine:
// every ancestor between a translation and its root must be a pairing container or explicitly excluded.
// The original class allowlist repeatedly missed ltx_theorem, ltx_transformed_inner, ltx_proof,
// and ltx_author_notes until users noticed broken pages. This turns those gaps into build-time failures.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract, markBlocks } from '@/core/extractor'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { MULTI_PANEL_FLEX, SIDE_DENY, SIDE_DENY_SUBTREE, SIDE_STACK, T_CLASS, isSideContainer } from '@/core/renderer'
import { docOf } from './helpers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')
const CSS = readFileSync(join(import.meta.dirname, '../../src/styles/modes.css'), 'utf8')
/** Comments discuss selectors too; strip them before text assertions */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Every container exclusion list in the stylesheet. modes.css repeats the list for grid declarations and pairing rules.
 * Checking only the first allowed the second to drift silently (issue #46). Normalize whitespace to compare multiline lists.
 */
function denyListsFromCss(): string[] {
  const re = /:where\(:has\(\.axt-t, \[data-axt-id\]\):not\(:is\(([\s\S]*?)\)\)\)/g
  const lists = [...RULES.matchAll(re)].map(m => m[1]!.replace(/\s+/g, ' ').trim())
  if (lists.length === 0) throw new Error('No container selector found in modes.css')
  return lists
}

/** Use the first stylesheet container selector; tests below ensure every copy matches TypeScript */
function containerFromCss(): string {
  return `:has(.${T_CLASS}, [data-axt-id]):not(:is(${denyListsFromCss()[0]!}))`
}

/** Simulate renderText by inserting one translated sibling per block */
function fakeTranslate(doc: Document): number {
  let n = 0
  for (const block of extract(doc)) {
    const node = doc.createElement(block.el.tagName)
    node.className = `${block.el.className} ${T_CLASS}`.trim()
    node.setAttribute('data-axt-for', block.id)
    node.textContent = '译文'
    block.el.after(node)
    n++
  }
  return n
}

describe('side-mode container coverage', () => {
  const container = containerFromCss()
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  it('every stylesheet exclusion list matches side-layout.ts, the source of truth; CSS contains two copies', () => {
    const parts = (v: string) => v.split(',').map(x => x.trim()).filter(Boolean)
    const normalize = (v: string[]) => [...new Set(v)].sort().join(',')
    // CSS expresses subtree exclusion as X and X *; TypeScript implements it with closest in isSideContainer.
    //happy-dom always rejects :is(X *), so folding it into SIDE_CONTAINER would diverge from browser behavior.
    const subtrees = parts(SIDE_DENY_SUBTREE).flatMap(x => [x, `${x} *`])
    const expected = normalize([...parts(SIDE_DENY), ...subtrees])
    const lists = denyListsFromCss()
    // Pin the count at two: grid declarations and pairing rules. A count of one means either intentional consolidation requiring a test update,
    // or a malformed list escaped the regex; without this count assertion that copy would go unchecked.
    expect(lists).toHaveLength(2)
    for (const [i, list] of lists.entries()) expect({ copy: i + 1, deny: normalize(parts(list)) }).toEqual({ copy: i + 1, deny: expected })
  })

  it('exclusions may contain only nongrid elements; ar5iv grids must be adopted rather than excluded', () => {
    // Excluding a grid ancestor does not stop descendants from subgridding its tracks, as observed in 2609.00097 ordered lists.
    for (const grid of ['.ltx_enumerate', '.ltx_biblist', '.ltx_bibitem', '.ltx_item']) {
      expect(SIDE_DENY).not.toContain(grid)
    }
  })

  it('excludes multipanel figures but adopts single-column flex figures based on full-width ltx_flex_size_1 cells', () => {
    // ar5iv flex places panels side by side; converting it to grid makes each panel fill a separate article-width row (2410.00260).
    // But single-column flex figures contain only size_1 full-width cells; excluding them stacks tables and notes vertically (2609.03768v1 Table 1).
    let multi = 0
    let single = 0
    for (const file of files) {
      const html = readFileSync(join(FIXTURE_DIR, file), 'utf8')
      // Skip parsing fixtures without flex figures: parsing all 12 exhausted the worker heap after reaching 4.4 GB RSS.
      if (!html.includes('ltx_flex_figure')) continue
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const root = doc.querySelector(DOCUMENT_ROOT)
      if (!root) continue
      fakeTranslate(doc)
      for (const figure of Array.from(root.querySelectorAll('.ltx_flex_figure'))) {
        const cells = Array.from(figure.querySelectorAll(':scope > .ltx_flex_cell'))
        const isMulti = cells.some(cell => !cell.classList.contains('ltx_flex_size_1'))
        expect(figure.matches(MULTI_PANEL_FLEX)).toBe(isMulti)
        for (const el of [figure, ...cells]) {
          // Multipanel figures exclude their whole subtree; single-column figures with translations remain ordinary containers.
          // Use isSideContainer because happy-dom mishandles complex :not(:is(...:has...)) selectors that Chrome handles correctly.
          expect(isSideContainer(el)).toBe(!isMulti && el.querySelector(`.${T_CLASS}`) !== null)
        }
        if (isMulti) multi++
        else single++
      }
    }
    expect(multi).toBeGreaterThan(0) // Fixtures contain both shapes, preventing a vacuous test.
    expect(single).toBeGreaterThan(0)
  })

  it('list markers stay outside grid flow with one copy per column', () => {
    // happy-dom has no layout engine; verify the rules here and see DESIGN §7.2 for visual measurements.
    expect(RULES).toMatch(/&\.ltx_item > \.ltx_tag \{[^}]*position: absolute/)
    // Mirrored markers need the right-column slot or they overlap left markers and leave the right column unnumbered.
    expect(RULES).toMatch(/&\.ltx_item > \.ltx_tag\.axt-t \{[^}]*inset-inline-start: calc\(50% \+ var\(--axt-gap\) \/ 2\)/)
  })

  it('list indentation applies only to cell content because inline padding on a subgrid container consumes the first track', () => {
    // Indenting list containers or items narrows the left column while leaving the right full-width (2312.17141: 444px versus 484px).
    expect(RULES).toMatch(/&:is\(\.ltx_itemize, \.ltx_enumerate, \.ltx_description\) \{\s*padding-inline-start: 0/)
    expect(RULES).toMatch(/&\.ltx_item:has\(> \.ltx_tag\) \{[^}]*padding-inline-start: 0/)
    // Indent direct container children only; descendant selectors also indent translations inside footnotes.
    expect(RULES).toMatch(/&:is\(\.ltx_item, \.ltx_item \*\) > :where\(\[data-axt-id\], :has\(\+ \.axt-t\), \.axt-t\):not\(\.ltx_tag\) \{\s*padding-inline-start: 2\.5rem/)
    expect(RULES).not.toMatch(/&\.ltx_item :where\(:has\(\+ \.axt-t\), \.axt-t\)/)
  })

  it('unpaired list items and mirrors share the marker slot; retaining ar5iv hanging markers would protrude beyond the column', () => {
    // 2609.04056v1 Definition 1.2 placed a formula-only first marker at x=208 versus sibling x=248, overlapping navigation.
    // Slot width must follow marker width; fixed 2.5rem lets wide markers such as item[(Assumption 1)] cover body text (Codex #40).
    expect(RULES).toMatch(/&:is\(\.ltx_itemize, \.ltx_enumerate, \.ltx_description\) > \.ltx_item:not\(:has\(\.axt-t, \[data-axt-id\]\)\) \{[^}]*grid-template-columns: minmax\(2\.5rem, max-content\)/)
    expect(RULES).toMatch(/&:is\(\.ltx_itemize, \.ltx_enumerate, \.ltx_description\) > \.ltx_item:not\(:has\(\.axt-t, \[data-axt-id\]\)\) \{[\s\S]*?& > \.ltx_tag \{[^}]*grid-column: 1/)
  })

  it('stylesheet stack-region lists match side-layout.ts as source of truth', () => {
    // CSS directly includes the TypeScript list with identical order and syntax; nested selector parentheses make regex extraction unsuitable.
    expect(RULES).toContain(`:is(${SIDE_STACK}) :is(.ltx_para, .ltx_abstract, :has(.axt-t, [data-axt-id]))`)
  })

  it('stack-region rules leave nested ltx_flex_figure unchanged because display:block would stack its panels (Codex #25)', () => {
    expect(RULES).toMatch(/:not\(:is\(\.ltx_note, \.ltx_note \*, \.ltx_flex_figure\)\)\s*\{\s*display: block/)
  })

  it('only mode does not use display:revert for pending or failed blocks because it would undo site display rules (Codex #19)', () => {
    expect(RULES).not.toMatch(/display:\s*revert/)
  })

  it('graphics in inline shrink-wrap containers are exempt from max-width to avoid pathological narrow widths', () => {
    expect(RULES).toMatch(/\.ltx_inline-block :is\(img, svg\) \{\s*max-width: none/)
  })

  it('resizebox-wrapped tables reach column lines despite their ltx_inline-block wrapper not being an inline context (2606.07636v2)', () => {
    // LaTeXML renders resizebox as div.ltx_inline-block.ltx_transformed_outer > span.ltx_transformed_inner > table.
    // ar5iv already neutralizes size and transforms; excluding the wrapper as inline prevents paired tables from reaching column lines:
    // the original and translated inline-tables center together in a full-width wrapper across the divider.
    const doc = docOf('<figure class="ltx_table"><figcaption class="ltx_caption" data-axt-id="c1">Table 1</figcaption>'
      + `<figcaption class="ltx_caption ${T_CLASS}" data-axt-for="c1">表 1</figcaption>`
      + '<div class="ltx_inline-block ltx_align_center ltx_transformed_outer" style="width:345.0pt"><span class="ltx_transformed_inner" style="transform:scale(1.16)">'
      + '<table class="ltx_tabular" data-axt-id="t1"><tbody><tr><td class="ltx_td">a</td></tr></tbody></table>'
      + `<table class="ltx_tabular ${T_CLASS}" data-axt-for="t1"><tbody><tr><td class="ltx_td">甲</td></tr></tbody></table>`
      + '</span></div></figure>')
    const outer = doc.querySelector('.ltx_transformed_outer')!
    const inner = doc.querySelector('.ltx_transformed_inner')!
    expect(isSideContainer(outer)).toBe(true)
    expect(isSideContainer(inner)).toBe(true)
    // It is not a stack region; otherwise the inner wrapper becomes block and both inline-tables center on one row.
    expect(outer.matches(SIDE_STACK)).toBe(false)
    // Real inline contexts remain excluded.
    const plain = docOf('<div class="ltx_para"><div class="ltx_inline-block" id="ib">'
      + `<p class="ltx_p" data-axt-id="p1">x</p><p class="ltx_p ${T_CLASS}" data-axt-for="p1">甲</p></div></div>`)
    const inlineBlock = plain.getElementById('ib')!
    expect(isSideContainer(inlineBlock)).toBe(false)
    expect(inlineBlock.matches(SIDE_STACK)).toBe(true)
  })

  it('footnote descendants are never pairing containers because changing display would expose collapsed ar5iv notes', () => {
    // ar5iv collapses notes with display:none on ltx_note_outer; container rules would override it with grid,
    // exposing a note across the body (2312.17141: 165px tall, 781px wide, overlapping center-column translations).
    const doc = docOf(`<div class="ltx_para"><span class="ltx_note"><span class="ltx_note_outer">
      <span class="ltx_note_content"><span class="ltx_p">note</span
      ><span class="ltx_p ${T_CLASS}" data-axt-for="1">脚注译文</span></span></span></span></div>`)
    const content = doc.querySelector('.ltx_note_content')!
    expect(content.matches(container)).toBe(true) // The raw selector alone would accept it as a container.
    expect(isSideContainer(content)).toBe(false) // Subtree exclusion rejects it.
  })

  it('keeps one footnote: after copying translation into the clone, CSS hides the original', () => {
    // Keep arXiv marginal notes at the right page edge; the problem is duplicate notes, not their placement.
    expect(RULES).toMatch(/\.ltx_note\[data-axt-note\] > \.ltx_note_outer \{\s*display: none/)
    // Do not pull marginal notes into the column: they squeeze body text and ar5iv height:0 can obscure list items.
    expect(RULES).not.toMatch(/\.ltx_note_outer \{[^}]*margin-inline-end: 0/)
    // Copied translations start on a new line without another footnote frame.
    expect(RULES).toMatch(/\.axt-note-t \{[^}]*display: block/)
  })

  for (const file of files) {
    it(`${file}: pairs reach the translation root; snapshots count pairs blocked by exclusions`, () => {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, file), 'utf8'), 'text/html')
      const root = doc.querySelector(DOCUMENT_ROOT)
      if (!root) return
      const total = fakeTranslate(doc)
      expect(total).toBeGreaterThan(0)

      // A pair becomes side by side only when every ancestor is a container.
      // An excluded ancestor falls back to stacking. Snapshots count pairs blocked by each exclusion class;
      // adding exclusions or reverting container detection to an allowlist changes these counts.
      let connected = 0
      const blockedBy = new Map<string, number>()
      for (const node of Array.from(doc.querySelectorAll(`.${T_CLASS}`))) {
        let cur = node.parentElement
        let blocker: string | null = null
        while (cur && cur !== root) {
          if (!cur.matches(container)) {
            blocker = Array.from(cur.classList).find(c => c.startsWith('ltx_')) ?? cur.tagName.toLowerCase()
            break
          }
          cur = cur.parentElement
        }
        if (blocker === null) connected++
        else blockedBy.set(blocker, (blockedBy.get(blocker) ?? 0) + 1)
      }

      expect({
        connected: `${connected}/${total}`,
        blockedBy: Object.fromEntries([...blockedBy].sort((a, b) => b[1] - a[1])),
      }).toMatchSnapshot()
    })
  }

  it('block markers alone create two-column containers at session startup without waiting for translations (2026-09-05 revision)', () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><body><article class="ltx_document"><section class="ltx_section"><div class="ltx_para"><p class="ltx_p" id="p1">Text.</p></div></section></article></body></html>',
      'text/html',
    )
    // happy-dom caches matches() by selector without invalidating for descendant attributes; use a separate document before marking.
    const untouched = new DOMParser().parseFromString(doc.documentElement.outerHTML, 'text/html')
    expect(isSideContainer(untouched.querySelector('.ltx_section')!)).toBe(false)
    markBlocks(extract(doc))
    expect(isSideContainer(doc.querySelector('.ltx_section')!)).toBe(true)
    expect(isSideContainer(doc.querySelector('.ltx_para')!)).toBe(true)
    // pairing rules place marked blocks in the left column without requiring an immediate translated sibling
    expect(RULES).toMatch(/& > :is\(\[data-axt-id\], :has\(\+ \.axt-t\)\) \{\s*grid-column: 1/)
  })
})
