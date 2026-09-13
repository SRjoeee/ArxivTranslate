// The layout guard of side mode (DESIGN §7.2).
// Not the style's effect (happy-dom has no layout engine) but **structural coverage** is tested here:
// every level between a translation node and the translation root is either a pairing container or on the explicit exclusion list.
// Early versions picked containers by a class-name allowlist, and .ltx_theorem, .ltx_transformed_inner, .ltx_proof,
// .ltx_author_notes slipped through one by one, each waiting for a reader to find it on the page. This test turns that kind of hole into a build failure.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract, markBlocks } from '@/core/extractor'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { T_CLASS } from '@/core/marks'
import { MULTI_PANEL_FLEX, SIDE_DENY, SIDE_DENY_SUBTREE, SIDE_STACK, isSideContainer } from '@/core/renderer/side-layout'
import { docOf } from './helpers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')
const CSS = readFileSync(join(import.meta.dirname, '../../src/styles/modes.css'), 'utf8')
/** The comments name selectors too (to explain trade-offs); strip them before a text assertion */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * The exclusion list of **every** container check in the style sheet. The same list is written more than once in modes.css (one for the grid declaration, one for the pairing rule);
 * only the first used to be checked, and the second could drift silently (issue #46). Whitespace is normalised to single spaces, so the multi-line copy compares
 */
function denyListsFromCss(): string[] {
  const re = /:where\(:has\(\.axt-t, \[data-axt-id\]\):not\(:is\(([\s\S]*?)\)\)\)/g
  const lists = [...RULES.matchAll(re)].map(m => m[1]!.replace(/\s+/g, ' ').trim())
  if (lists.length === 0) throw new Error('no container-check selector found in modes.css')
  return lists
}

/** The container selector is the style sheet's first copy; every copy agreeing with the TS is guarded by the tests below */
function containerFromCss(): string {
  return `:has(.${T_CLASS}, [data-axt-id]):not(:is(${denyListsFromCss()[0]!}))`
}

/** Imitated rendering: inserts a translation sibling for every block, shaped as renderText does */
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

describe('side mode\'s container coverage', () => {
  const container = containerFromCss()
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  it('every exclusion list in the style sheet agrees with side-layout.ts (the TS is the source of truth; the list is written twice in the style sheet)', () => {
    const parts = (v: string) => v.split(',').map(x => x.trim()).filter(Boolean)
    const normalize = (v: string[]) => [...new Set(v)].sort().join(',')
    // A subtree exclusion is written as two entries `X, X *` in the style sheet; on the TS side isSideContainer implements it with closest
    // (happy-dom's :is(X *) is always false, and folding it into SIDE_CONTAINER would make the test disagree with the live behaviour)
    const subtrees = parts(SIDE_DENY_SUBTREE).flatMap(x => [x, `${x} *`])
    const expected = normalize([...parts(SIDE_DENY), ...subtrees])
    const lists = denyListsFromCss()
    // The count is pinned: today it is two (grid declaration + pairing rule). Becoming 1 means either they were merged (update this),
    // or one copy was broken and slipped past the regex above — without this line the one that slipped would go unchecked
    expect(lists).toHaveLength(2)
    for (const [i, list] of lists.entries()) expect({ copy: i + 1, deny: normalize(parts(list)) }).toEqual({ copy: i + 1, deny: expected })
  })

  it('an exclusion may only be an element that forms no grid of its own: ar5iv\'s own grids must be taken over, not excluded', () => {
    // Excluding a grid ancestor does not stop a descendant from subgridding its tracks (measured on 2609.00097's ordered list)
    for (const grid of ['.ltx_enumerate', '.ltx_biblist', '.ltx_bibitem', '.ltx_item']) {
      expect(SIDE_DENY).not.toContain(grid)
    }
  })

  it('a multi-panel figure is not taken over, a single-column flex figure is: only whether the cells are full-column counts (ltx_flex_size_1)', () => {
    // ar5iv uses flex to put panels side by side; taken over as a grid, each panel takes a row of its own and fills the article column (measured on 2410.00260);
    // but the cells of a single-column flex figure, all size_1, are full-column wide, and excluding it would only stack tables and footnotes vertically (measured on 2609.03768v1's Table 1)
    let multi = 0
    let single = 0
    for (const file of files) {
      const html = readFileSync(join(FIXTURE_DIR, file), 'utf8')
      // Fixtures without a flex figure are not parsed: parsing all 12 blows the worker's heap (measured: OOM after 4.4 GB RSS)
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
          // Multi-panel: the whole subtree is not taken over; single-column: with a translation inside it is an ordinary container.
          // isSideContainer rather than the raw selector: happy-dom misjudges :not(:is(complex selectors with :has)), live Chrome is fine
          expect(isSideContainer(el)).toBe(!isMulti && el.querySelector(`.${T_CLASS}`) !== null)
        }
        if (isMulti) multi++
        else single++
      }
    }
    expect(multi).toBeGreaterThan(0) // // the fixtures hold both kinds, so this test is no empty run
    expect(single).toBeGreaterThan(0)
  })

  it('list markers have to leave the grid flow, with one copy hanging in each column', () => {
    // happy-dom has no layout engine; the rule itself is guarded here, the effect measured in DESIGN §7.2
    expect(RULES).toMatch(/&\.ltx_item > \.ltx_tag \{[^}]*position: absolute/)
    // The mirror marker has to land in the right column's slot, or it stacks on the original marker in the left column and the right has no number
    expect(RULES).toMatch(/&\.ltx_item > \.ltx_tag\.axt-t \{[^}]*inset-inline-start: calc\(50% \+ var\(--axt-gap\) \/ 2\)/)
  })

  it('list indentation may only go on the cell content: a subgrid container\'s own inline padding eats the first track', () => {
    // On the list container / list item it makes the left column a stretch narrower and the right flush (measured on 2312.17141: left 444 / right 484)
    expect(RULES).toMatch(/&:is\(\.ltx_itemize, \.ltx_enumerate, \.ltx_description\) \{\s*padding-inline-start: 0/)
    expect(RULES).toMatch(/&\.ltx_item:has\(> \.ltx_tag\) \{[^}]*padding-inline-start: 0/)
    // Indent only the container's direct children: a descendant selector would indent the translation inside a footnote too (measured)
    expect(RULES).toMatch(/&:is\(\.ltx_item, \.ltx_item \*\) > :where\(\[data-axt-id\], :has\(\+ \.axt-t\), \.axt-t\):not\(\.ltx_tag\) \{\s*padding-inline-start: 2\.5rem/)
    expect(RULES).not.toMatch(/&\.ltx_item :where\(:has\(\+ \.axt-t\), \.axt-t\)/)
  })

  it('unpaired list items and their mirrors use the same marker slot: an item that is no grid keeping ar5iv\'s hanging marker sticks out of the column', () => {
    // Measured on 2609.04056v1 Definition 1.2: the formula-only first item's marker at x=208, the sibling's at 248, pressed onto the navigation bar
    // The slot width has to follow the marker: hard-coded at 2.5rem, a wide marker like \item[(Assumption 1)] covers the body text (Codex on #40)
    expect(RULES).toMatch(/&:is\(\.ltx_itemize, \.ltx_enumerate, \.ltx_description\) > \.ltx_item:not\(:has\(\.axt-t, \[data-axt-id\]\)\) \{[^}]*grid-template-columns: minmax\(2\.5rem, max-content\)/)
    expect(RULES).toMatch(/&:is\(\.ltx_itemize, \.ltx_enumerate, \.ltx_description\) > \.ltx_item:not\(:has\(\.axt-t, \[data-axt-id\]\)\) \{[\s\S]*?& > \.ltx_tag \{[^}]*grid-column: 1/)
  })

  it('the stacked-area list: the style sheet agrees with side-layout.ts (the TS is the source of truth)', () => {
    // The stacked-area rule in the style sheet quotes the TS list verbatim (order and spelling must agree; the selectors have nested parentheses, so no regex digging any more)
    expect(RULES).toContain(`:is(${SIDE_STACK}) :is(.ltx_para, .ltx_abstract, :has(.axt-t, [data-axt-id]))`)
  })

  it('the stacked-area rule leaves a nested .ltx_flex_figure alone: it is flex itself, and squeezed to block its panels would stack vertically (Codex on #25)', () => {
    expect(RULES).toMatch(/:not\(:is\(\.ltx_note, \.ltx_note \*, \.ltx_flex_figure\)\)\s*\{\s*display: block/)
  })

  it('only mode does not use display: revert to reveal pending / failed: revert would undo the site\'s display (Codex on #19)', () => {
    expect(RULES).not.toMatch(/display:\s*revert/)
  })

  it('graphics inside an inline shrink-wrap are exempt from max-width: otherwise the width resolves to a pathological narrow value', () => {
    expect(RULES).toMatch(/\.ltx_inline-block :is\(img, svg\) \{\s*max-width: none/)
  })

  it('a table wrapped in \\resizebox reaches the column lines: the wrapper carries .ltx_inline-block but is no inline context (measured on 2606.07636v2)', () => {
    // LaTeXML gives \resizebox a div.ltx_inline-block.ltx_transformed_outer > span.ltx_transformed_inner > table,
    // and ar5iv itself flattens the width, height and transform. Excluding the wrapper as an inline context, the table pair inside cannot reach the two column lines:
    // the source and translated tables are two inline-tables, centred in one row inside the full-width shell, straddling the divider
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
    // The stacked area does not claim it: claimed, the inner would be squeezed to block and the two inline-tables centred in one row instead
    expect(outer.matches(SIDE_STACK)).toBe(false)
    // A real inline context is excluded as before
    const plain = docOf('<div class="ltx_para"><div class="ltx_inline-block" id="ib">'
      + `<p class="ltx_p" data-axt-id="p1">x</p><p class="ltx_p ${T_CLASS}" data-axt-for="p1">甲</p></div></div>`)
    const inlineBlock = plain.getElementById('ib')!
    expect(isSideContainer(inlineBlock)).toBe(false)
    expect(inlineBlock.matches(SIDE_STACK)).toBe(true)
  })

  it('the inside of a footnote never counts as a pairing container: changing its display would unfold ar5iv\'s collapsed footnote', () => {
    // ar5iv keeps the collapsed state on .ltx_note_outer's display:none; once the container rule matches it becomes grid,
    // and the footnote unfolds across the body text (measured on 2312.17141: 165px high, 781px wide, interfering with the middle column's translation)
    const doc = docOf(`<div class="ltx_para"><span class="ltx_note"><span class="ltx_note_outer">
      <span class="ltx_note_content"><span class="ltx_p">note</span
      ><span class="ltx_p ${T_CLASS}" data-axt-for="1">脚注译文</span></span></span></span></div>`)
    const content = doc.querySelector('.ltx_note_content')!
    expect(content.matches(container)).toBe(true) // // by the selector alone it qualifies as a container
    expect(isSideContainer(content)).toBe(false) // // the subtree exclusion keeps it out
  })

  it('one copy of a footnote: once the translation is copied into the copy, the original is hidden by the style', () => {
    // Margin notes hanging at the page's right edge are arXiv's own layout, not to be changed; the problem to solve is the same footnote appearing twice
    expect(RULES).toMatch(/\.ltx_note\[data-axt-note\] > \.ltx_note_outer \{\s*display: none/)
    // Do not pull the margin note back into the column: the body text gets squeezed, and list items are covered by ar5iv's hard-coded height:0
    expect(RULES).not.toMatch(/\.ltx_note_outer \{[^}]*margin-inline-end: 0/)
    // The translation moved into the copy starts a new line and is not wrapped in a second footnote frame
    expect(RULES).toMatch(/\.axt-note-t \{[^}]*display: block/)
  })

  for (const file of files) {
    it(`${file}: whether a pair reaches the translation root; the snapshot records how many each exclusion blocked`, () => {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, file), 'utf8'), 'text/html')
      const root = doc.querySelector(DOCUMENT_ROOT)
      if (!root) return
      const total = fakeTranslate(doc)
      expect(total).toBeGreaterThan(0)

      // A pair really splits into two columns only when every level of the ancestor chain is a container;
      // an excluded element on the chain degrades it to stacking. The snapshot records how many each kind of exclusion blocked,
      // and adding to the exclusion list, or the container check falling back to an allowlist, changes these numbers.
      // **`tbody` blocks the intertext rows of equation groups** (issue #152), which is right: this pass only
      // `fakeTranslate`s, and in the real flow `splitFigures` splits the whole group in two — the original table into the left column,
      // the translation-only copy into the right, and the pairing chain never needs to reach the row (the inside of tables is on the exclusion list anyway)
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

  it('the block mark itself makes the container a two-column grid: the whole page goes two-column as the session starts, without waiting for translations (revised 2026-09-05)', () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><body><article class="ltx_document"><section class="ltx_section"><div class="ltx_para"><p class="ltx_p" id="p1">Text.</p></div></section></article></body></html>',
      'text/html',
    )
    // happy-dom caches matches() results by selector string and does not refresh when a descendant's attribute changes, so “before marking” uses another document
    const untouched = new DOMParser().parseFromString(doc.documentElement.outerHTML, 'text/html')
    expect(isSideContainer(untouched.querySelector('.ltx_section')!)).toBe(false)
    markBlocks(extract(doc))
    expect(isSideContainer(doc.querySelector('.ltx_section')!)).toBe(true)
    expect(isSideContainer(doc.querySelector('.ltx_para')!)).toBe(true)
    // The pairing rule: a marked block takes the left column, no longer requiring a translation right after it
    expect(RULES).toMatch(/& > :is\(\[data-axt-id\], :has\(\+ \.axt-t\)\) \{\s*grid-column: 1/)
  })
})
