# Phase 0 research record

> Translated into English on 2026-09-13 as part of the repository-wide English sweep; the content is the frozen record and is unchanged.

Date: 2026-09-03 · corresponds to DESIGN.md v0.1 · status: Phase 0 tasks 1–7 all complete

[Note 2026-09-12: this file grew past Phase 0 — §5.1 and §6.4–6.11 are measurements made up to 2026-09-09. It is a frozen record of the MVP (ADR-0001 §3): cite it as evidence, do not treat it as the spec. The status of every row of the §7 revision list is given under that heading.]

This document records the measured conclusions of Phase 0. Wherever they disagree with DESIGN.md, the disagreement is only recorded here and a revision proposed in §7; the design is not changed directly.
Scripts: `pnpm fixtures:stats` (`scripts/fixtures-stats.ts`, the rule coverage audit), `scripts/phase0/fetch-candidates.sh` (candidate fetching), `scripts/phase0/candidate-stats.sh` (coarse feature counts), `scripts/phase0/td-numeric-calib.ts` (calibration of the §5.3 numeric-cell regex), `scripts/phase0/translator-probe.js` (the Translator API probe).
Phase 0 has no test or build target yet; `pnpm test` / `pnpm build` apply from Phase 1.

---

## 1. Fixtures

10 papers are saved in `tests/fixtures/arxiv/<id>.html`; the list and the reasons for choosing them are in that directory's `README.md`. Coverage: formula-dense (3), algorithm / code blocks (4), large tables / numeric tables (4), footnotes / theorems (4), 4 from 2023, 1 each from 2024 / 2025, 4 from 2026, `.ltx_ERROR` 2 (one of them a failed-conversion page).

**Key findings**

1. **No page of an “early LaTeXML version” exists online.** The generator comment of all 56 candidates (2023-12 to 2026-09) is `LaTeXML oxide (version 0.7.6)`, papers from December 2023 included; a versioned URL (`/html/2312.17127v1`) returns oxide 0.7.6 too. arXiv has regenerated its historical articles with the new converter and the old output is unobtainable. The goal “cover LaTeXML version differences by year” therefore cannot be met through online pages today, and the rules need only target the one version oxide 0.7.6; the version probe and the branching mechanism should stay all the same, against a future upgrade.
2. Not every paper has HTML: 4 of the 60 candidates were 404 (no LaTeX source, or a failed conversion never published). The extension only needs to handle pages that have HTML, with no extra check.
3. Pages that failed conversion yet were published exist (`2608.30667`): the `<title>` is "Untitled Document", the body is a single `.ltx_p`, `.ltx_ERROR` marks the undefined macros. On such a page the extension must exit quietly or translate only what it can, never report an error.
4. Fetching notes: `export.arxiv.org` over http 301s to https, so curl needs `-L`; the API's `[a TO b]` needs `-g` to switch globbing off; a single request occasionally hangs, so `--max-time` is a must; keep the 3-second interval.
5. **Papers with old-style ids have HTML too** (curl-verified 2026-09-05 after Codex's comment on #9): `/html/hep-th/9901001` returns a complete LaTeXML page (`article.ltx_document`, title "String Junctions and Their Duals…"), `/html/math/0601001` is 200 likewise. `paperIdFromUrl` therefore has to accept `archive[.subject]/YYMMNNN[vN]`.

## 2. Rule coverage audit

Method: `pnpm fixtures:stats` parses the 10 fixtures with happy-dom, imports the rules from `src/core/rules/latexml.ts` (`RULES_VERSION 0.1.0-phase0`, entered rule by rule from DESIGN.md §5.1 / §5.2), and for every non-blank text node inside the translation root `article.ltx_document` looks upward for the nearest skip-rule ancestor S and translation-unit ancestor U, sorting into four classes: `unit` (inside a unit, no skip), `protected` (S inside U, i.e. a protected node within a block), `skipped` (S above U, or no U), `uncovered` (neither). The full report is `docs/phase0/rules-audit.md` (generated).

### 2.1 Overview

| fixture | parse ms | text nodes | unit | protected | skipped | uncovered |
|---|---|---|---|---|---|---|
| 2312.17141 | 238 | 18375 | 19.6% | 51.2% | 29.1% | 14 |
| 2312.17527 | 53 | 4294 | 21.9% | 47.9% | 30.2% | 0 |
| 2401.00418 | 189 | 20524 | 14.5% | 82.4% | 3.2% | 0 |
| 2401.00596 | 53 | 4044 | 49.4% | 47.7% | 3.0% | 1 |
| 2410.00260 | 41 | 1750 | 52.9% | 25.9% | 21.1% | 2 |
| 2507.00150 | 51 | 3551 | 49.1% | 49.7% | 0.8% | 13 |
| 2608.29808 | 121 | 5891 | 59.3% | 10.5% | 30.2% | 0 |
| 2608.30667 | 3 | 4 | 50.0% | 25.0% | 25.0% | 0 |
| 2609.00245 | 618 | 37556 | 12.9% | 49.6% | 37.5% | 0 |
| 2609.00246 | 263 | 16279 | 26.9% | 30.6% | 42.4% | 3 |

Two more were fetched on 2026-09-05 for the side-mode layout regression (not counted in the table above): 2609.04056 (math.OC; formula-only list items inside a theorem, an acknowledgements block in the right gutter), 2609.03768 (physics.comp-ph; a table + footnote inside a single-column flex figure), see `tests/fixtures/arxiv/README.md`.

112,268 text nodes in all, 33 uncovered (0.03%). happy-dom parses the 1.8 MB page in 618 ms, directly usable in Vitest. The high `protected` share is because the `mo` / `mi` / `mn` / `annotation` inside MathML all count as text nodes.

### 2.2 (a) Selectors in the rules that match no fixture

Every rule has matching elements, but `.ltx_author` and `.ltx_date` **never occur** in the 10 papers (the authors rule hits through the `.ltx_authors` / `.ltx_contact` in the same selector). The real author-area class names are `.ltx_authors > .ltx_creator > .ltx_personname` / `.ltx_author_notes` / `.ltx_role_affiliation` / `.ltx_contact`; the date is `.ltx_dates` (3 papers).

### 2.3 (b) Uncovered text

All 33 nodes are in the frontmatter / backmatter; body paragraphs have zero uncovered:

| Structure | Nodes | Suggested handling |
|---|---|---|
| `div.ltx_acknowledgements` (with inner `.ltx_text`, `a.ltx_ref.ltx_url`) | 12 | New translation unit |
| `.ltx_pubnotes.ltx_pubnotes_meta > .ltx_pubnote.ltx_role_{ccs,doi,journal,number,publicationmonth}` (the ACM template's publication metadata, with `.ltx_note_name` labels) | 12 | New skip rule `.ltx_pubnotes` |
| `div.ltx_dates` | 3 | Skip (replaces the `.ltx_date` that does not exist in the rules) |
| `sup.ltx_note_mark` directly under `.ltx_note.ltx_role_footnotetext` | 2 | `.ltx_note_mark` into the protected list (see 2.5) |
| `div.ltx_keywords` (with `.ltx_text` children) | 2 | New translation unit |
| `div.ltx_subtitle` | 1 | Folded into the title rule |
| `svg foreignObject > .ltx_foreignobject_content` (text inside a TikZ picture) | 1 | Skip the whole `svg` |

### 2.4 Rule redundancy and priority

Combinations of several rules matching one unit element at once: `p+theorem` 30,607, `p+item+theorem` 9,626, `p+item` 1,830, `p+abstract` 150. §5.1's three rules `.ltx_abstract .ltx_p`, `.ltx_item .ltx_p`, `.ltx_theorem .ltx_p, .ltx_proof .ltx_p` are **entirely covered by `.ltx_p`**, and as independent rules they break “exactly one”. Suggested: delete them, or turn them into context marks (giving the prompt the information “this is a theorem / the abstract”) that take no part in block classification.

### 2.5 The protected nodes of §6.1 must enter the rule table

The audit used only §5.2's skip rules, and the result exposes that the void nodes §6.1 lists are treated as paragraph body today:

| Element | Elements with direct text | Notes |
|---|---|---|
| `a.ltx_ref` (with `span.ltx_ref_tag.ltx_text`) | 1045 + 1639 | Cross-references "Section 2", "Theorem 1" and their numbers |
| `cite.ltx_cite.ltx_citemacro_*` | 713 | Citation marks |
| `sup.ltx_note_mark` | 112 | Footnote marks, once in the outer `.ltx_note` and once inside `.ltx_note_content` |

They have to be written into `latexml.ts` (`PROTECT_RULES`) as void placeholders, on the same level as `.ltx_tag`, `math`, `code`, `.ltx_font_typewriter`. Another structural finding: **footnotes are nested blocks** — `.ltx_note` (mark + `.ltx_note_outer > .ltx_note_content`) sits whole inside the `.ltx_p`, while `.ltx_note_content` is itself a translation unit. On extraction the outer paragraph should treat the whole `.ltx_note` as a void placeholder and the footnote body becomes a block of its own; the second `.ltx_note_mark` inside `.ltx_note_content` and `.ltx_note_type` ("footnotemark:", 1 paper only) are voids.

### 2.6 Table cells and the §5.3 numeric-cell regex

`scripts/phase0/td-numeric-calib.ts` over 5,487 `.ltx_td` (visible text with MathML subtrees excluded): 271 empty, 294 pure formula, 3,236 (59%) matching the draft regex, 1,686 prose. The draft regex has two problems:

- **False positives**: the `e` / `E` in the character class (meant for exponents) lets words starting with E match whole — `ERROR` 90 times, `Esp`, `ESBMC`. Fix: require at least one digit (a lookahead `(?=.*\d)`).
- **False negatives**: `✓` 167 times, `N/A` 17 times, single letters `G` / `N` / `Y` / `S`, units in parentheses `(kpc)`, `Au+Au`. Fix: add a “pure symbol” branch (`✓ ✗ ✔ ✘ – — −`) and `N/A`.

There are also 427 upper-case enumeration values `TRUE` / `FALSE` / `UNKNOWN` (one paper) — values, not prose, but a regex cannot tell them from abbreviations; leave them to the provider (an LLM keeps them). Suggested regex: `^(?=.*\d)[\s\d.,+\-±×^%()/*eE−–—:;~<>=≤≥∼]+(\s*[a-zA-Zμ°%]{1,4})?$` or `^[✓✗✔✘–—−\-·×*]+$` or `^N/A$`. Values with units such as `7.7 GeV` match correctly.

### 2.7 Code and algorithm boxes

- The listing container class is `.ltx_listing` (sometimes with `.ltx_lstlisting`, `.ltx_lst_language_*` on top), lines are `.ltx_listingline`, line numbers `.ltx_tag.ltx_tag_listingline`. `.ltx_listing_data` (the hidden raw code data) needs skipping.
- Algorithm boxes `figure.ltx_float.ltx_algorithm` (2 papers) / `.ltx_float_algorithm` (1 paper) hold `.ltx_listingline` inside, covered by the code rule already; the `.ltx_caption` inside the box translates as usual.
- `.ltx_verbatim` in 2 papers; `pre` / `code` tags do not occur on their own in the body (monospace text is all `.ltx_text.ltx_font_typewriter`, 2,488 elements).

### 2.8 (c) Class name distribution

255 `ltx_*` class names inside the translation root; only 2 (`ltx_Math`, base classes of the `ltx_p` level) occur in all 10 papers; the long tail is mostly template-related (ACM's `ltx_affiliation_*`, `ltx_role_*`), bibliography subdivisions (`ltx_bib_*`, twenty-odd, only in 2609.00246), theorem kinds (`ltx_theorem_*`), listing languages (`ltx_lst_language_*`). All of these sit inside existing units and need no rule of their own. Since every fixture is oxide 0.7.6 alike, this table reflects content distribution, not version differences.

### 2.9 Share of SVG figures (§15.1)

164 `svg` inside the translation root, all `svg.ltx_picture` (TikZ), 114 of them in 2608.29808 and 43 in 2312.17141 (most with `ltx_markedasmath`, formulas drawn as pictures); **not one contains `<text>`**; text appears only as `foreignObject > .ltx_foreignobject_content`, and across all fixtures that is 1 text node. Bitmaps `img.ltx_graphics`: 13 (5 papers). Conclusion: SVG figures carry no translatable DOM text in practice, v1 skips `svg` whole; the OCR route of §15 is meaningful for `img` only.

[Correction 2026-09-12: superseded. Inline TikZ pictures do carry translatable text in `foreignObject` (199 word-bearing labels in the corpus); DESIGN §15.6 routes them through the image pipeline. The "skip `svg`" rule remains only for the text pipeline.]

### 2.10 Other

- `.ltx_p` is not always a `<p>`: `span.ltx_p` 57 times (2 papers, inside tables and inline-blocks). §7.1 "same tag name as the original block" covers it already; the grid technique of §7.2 works only for `.ltx_para > p.ltx_p`, the rest degrade to stack.
- The only text outside the translation root is the table of contents inside `.ltx_page_navbar` (`ltx_ref_title`, `ltx_tag_ref`, math / italic inside TOC titles) and arXiv's header and footer, which confirms "nothing outside the root is extracted".
- The failed-conversion page `2608.30667`: 4 text nodes, 2 units, the script runs without incident; the extension should be able to work quietly on such a page.

### 2.11 Re-run at RULES_VERSION 0.2.0 (Phase 1 `feat/rules`)

The audit script now calls the rule module's `classify()` directly (priority skip > table > unit > protect, `.ltx_note` as protect-but-descend); the report was regenerated to `docs/phase0/rules-audit.md`: [2026-09-12: the committed report was removed; regenerate it with `pnpm fixtures:stats`.]

- **Uncovered 0 / 112,268**: acknowledgements, keywords and subtitle enter unit; publication metadata, dates and SVG enter skip; `.ltx_note_mark` enters protect.
- No dead rules; the unit rules are pairwise exclusive (`multi` is empty), so “exactly one” holds.
- Attribution changes: `.ltx_ref` (3,253 text nodes), `.ltx_cite` (1,872), `.ltx_note_mark` (114) moved from paragraph body to protected nodes; 4,632 table-cell text nodes go to `table`; 166 footnote-body nodes go to the nested unit `footnote`, the `.ltx_note` container itself attributes 0.
- The unit share therefore drops (e.g. 2401.00596 from 49.4% to 26.6%), the true figure once citation and footnote marks are taken out of the “text to translate”.

### 2.12 Checking rule coverage backwards from the CSS class list (2026-09-04)

The starting point was a hypothesis: ar5iv's CSS covers every block, so it can be used to complete the rules. **Measured, the hypothesis does not hold.**

Putting together all 15 style sheets under the LaTeXML repository's `lib/LaTeXML/resources/CSS` (template-specific ones such as `ltx-book.css`, `ltx-amsart.css`, `ltx-apj.css` included), the ar5iv repository's and the two arXiv actually serves gives **322 `ltx_*` classes**. Comparing against 20 new papers fetched from 8 subject areas:

- **88 classes occur in the pages and in none of the CSS**, and they are no fringe: `ltx_Math` 20/20 papers, `ltx_ref_tag` 20/20, `ltx_tag_bibitem` 20/20, `ltx_math_unparsed` 18/20, `ltx_citemacro_cite` 17/20, and the two families `ltx_theorem_*` and `ltx_bib_*`
- The reason is that **the class names are an open set**: `ltx_theorem_maintheoremA`, `ltx_theorem_manualconjectureinner`, `ltx_bib_<field>`, `ltx_citemacro_<macro>`, `ltx_colspan_8` are all generated from the authors' own LaTeX macro names, and no style sheet can list them all
- In the other direction **145 classes exist only in the CSS**: template-specific structures for books / CVs / indexes / epigraphs that never occur once in the 30 real papers

Coverage check (attributing every text node with `classify()`): **36348 text-bearing nodes across the 20 new papers + 10 fixtures, 1 uncovered** — the MSC classification code of a mathematics paper (`.ltx_classification`), which should not be translated anyway.

Conclusion: the rules are not made complete by enumerating class names but by the structural property “containers need no rules; text lands in a few units such as `.ltx_p`”. The value of the CSS list is in the third point — those 145 unseen structures, written after LaTeXML's output conventions into `tests/fixtures/arxiv/synthetic-structures.html`, exposed 8 real gaps on the first run (`.ltx_date`, `.ltx_role_dedicatory`, the bare text of description terms, `.ltx_marginpar`, `.ltx_indexentry`, CV fields), now added to the rules.

The missed translation reported earlier (acknowledgement-type notes in the author area) had nothing to do with rule completeness; it came from the §5.2 policy “skip the author area whole”, changed to translate by default in the same revision.

**Added 2026-09-12: `\intertext` (issue #152).** This synthetic fixture later came to hold shapes that **occur in real papers but not in the 13 fetched**. The first such entry is the `\intertext` explanatory row inside an equation group, copied byte for byte from `arxiv.org/html/2609.09360v1` (cut after the second explanatory row, about 9 KB).

**Why the whole paper is not put into `tests/fixtures/arxiv/`**: measured, adding a 13th real paper (688 KB) made both workers `protector/fixtures` and `renderer/fixtures` **heap OOM** — a corpus test runs all fixtures sequentially in one worker, and each paper has to keep the whole DOM plus an `outerHTML` snapshot for the "DOM unchanged byte for byte afterwards" comparison; 12 papers already sit against the heap limit, and that one paper alone runs without any problem. Putting it into the synthetic fixture adds only 9 KB, and every corpus scan (protector round trip, selector boundary, extraction, side layout) still gets the shape. As the corpus keeps growing the heap limit will need handling of its own sooner or later; that is another matter.

---

## 3. Containers and navigation

### 3.1 Page skeleton (oxide 0.7.6 + arXiv theme 2026-08)

```
body                                  ← display:grid at ≥1280px (see 3.2)
├─ header.arxiv-html-header           ← injected by arXiv: logo, nav.html-header-nav
├─ nav.ltx_page_navbar                ← the LaTeXML navigation bar, holding nav.ltx_TOC
├─ div.ltx_page_main
│  └─ div.ltx_page_content
│     └─ article.ltx_document         ← the paper body, max-width: var(--main-width)
├─ footer.arxiv-html-footer           ← injected by arXiv
├─ footer.ds-site-footer              ← injected by arXiv (site footer)
└─ other arXiv injections: #infobox, #watermark-tr, .keyboard-glossary, #fixed-buttons-container,
   the report-issue modal (.modal-header / .modal-body / .modal-footer, form #modal-form), .ds-announcement
```

Main container: `article.ltx_document` is the translation root; `.ltx_page_navbar` and every injected element without the `ltx_` prefix never enter extraction.

### 3.2 Width control (decides how side mode is done)

- The one source of width is the CSS variable `--main-width`, defined as `52rem` in the ar5iv style's `:root`.
- `.ltx_document { max-width: var(--main-width) }`; `.ltx_page_main { width: 100% }` (unbounded).
- Under `@media (min-width: 1280px)` the arXiv theme sets `body` to `display: grid; grid-template-columns: 1fr var(--nav-width) var(--main-width) var(--nav-width) 1fr`, `--nav-width: minmax(14rem, 25rem)`; `div.ltx_page_main` lands in the `article` area, `nav.ltx_page_navbar` in the `nav` area.
- Therefore **side mode need only override `--main-width` on `html[data-axt-mode="side"]`** (e.g. `min(1600px, 96vw)`); the article column and `.ltx_document` widen together, and `.ltx_page_main` is untouched.
- Side effect: `--main-width` is also referenced by images (`.ltx_graphics`, `.ltx_img_*`), the code block `.ltx_listing`, the `max-width` of cells `.ltx_td`, and the absolute positioning of footnotes at ≥96rem (`--main-width-margin`); enlarging the variable enlarges these too. Wider images are usually acceptable; if not, pin those rules' `max-width` back to `52rem` in side mode.
- Breakpoints: the arXiv theme's 1280px (navigation bar / header collapse; `narrowViewport` in the JS has the same value); the ar5iv style has its own 46/52/96/109rem breakpoints, of which 96rem decides whether footnotes pop up or sit in the margin. The 1100px auto-fallback threshold of DESIGN.md §7.2 aligns with neither set; suggested: 1280px, matching arXiv.

### 3.3 Behaviour of arXiv's own JS (`/static/browse/0.3.4/js/arxiv-html-papers-*.js`, 268 lines)

- It touches the DOM in three places only: the `data-theme` / `data-toc-display` / `data-reading-mode` attributes on `html` (preferences in localStorage: `ar5iv_theme`, `arxiv_html_paper_toc_display`, `arxiv_html_paper_reading_mode`); toggling the display of `.ltx_page_navbar > nav.ltx_TOC`; a `mouseup` listener on `.ltx_page_content` that stores the selection's `innerHTML` for the "report issue" form.
- **No** MutationObserver, **no** MathJax (0 occurrences on the page; formulas are native MathML), **no** footnote JS.
- Footnote pop-ups are pure CSS: below 96rem `.ltx_note:focus-within > .ltx_note_outer` pops up; at ≥96rem `.ltx_note.ltx_role_footnotetext .ltx_note_outer` is absolutely positioned as a margin note. Once the translation clones the footnote mark, the clone triggers the pop-up just the same (an identical structure suffices), no extra handling.
- Conflict surface: almost none. The one intersection is a user selecting translated text and clicking "report issue": the selection HTML carries `.axt-t` nodes, harmless.
- The header script `arxiv-header.js` only handles the site banner and announcements, nothing to do with the body.
- The page's inline `<script>` only restores the preference attributes above early; the inline `<style>` is 535 bytes.

### 3.4 Reading mode versus our modes

arXiv's `data-reading-mode=enabled` hides `header.arxiv-html-header` and `.ltx_page_navbar`. If our side mode needs to hide the navigation bar, set `html[data-axt-mode="side"] .ltx_page_navbar { display:none }` directly and do not write arXiv's attribute (it would persist it to localStorage).

### 3.5 The site's rules for lists and multi-panel figures (2026-09-05, `ar5iv.0.9.1.min.css`)

The style entry `/static/browse/0.3.4/css/arxiv-html-papers-20260823.css` is two `@import` lines only: `ar5iv.0.9.1.min.css` into `layer(ar5iv)`, `arxiv-html-papers-theme-20260807.css` into `layer(arxiv-theme)` (fetch with `curl -L`). Directly relevant to side-mode list layout:

- `li.ltx_item > .ltx_tag { display: inline; margin-inline-start: -2.5rem; padding-inline-end: .5rem; text-align: end }` — itemize markers hang by 2.5rem; the 2.5rem marker slot in modes.css comes from this
- `.ltx_enumerate { display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: .5em; padding-inline-start: 0 }`, `.ltx_enumerate > .ltx_item { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1 }` — enumerate's number column is sized **by content**, so a long label ("(Assumption 1)") does not overflow in the original layout; our fixed 2.5rem absolutely positioned slot does (Codex #25), but the site has **no** variable such as `--ltx-enum-leftmargin` to read, so the proposal to size by a variable does not hold
- The indentation of nested lists is only `.ltx_item > .ltx_para > :is(.ltx_enumerate, .ltx_itemize, .ltx_description) { margin-inline-start: var(--space-xs) }` plus the inner list's own number column; once side mode makes markers absolutely positioned that level of indentation is lost (Codex #25, the (k.i) list of 2609.00245), left for the batch of real-browser layout tests

Directly relevant to side mode's **width contract** (added 2026-09-05, DESIGN §7.2):

- The theme's `body { grid-template-columns: 1fr var(--nav-width) var(--main-width) var(--nav-width) 1fr; grid-template-areas: "... . nav article . ." }`, `--nav-width: minmax(14rem, 25rem)`; the 4th column has no named area. Measured native: `0 224 832 224 0` at 1280px, the navigation capped at 400 at ≥ 1800px
- `.ltx_page_content { margin: 1rem }` (the theme overrides ar5iv's `var(--space-xl) var(--space-sm)`) — the article column minus 2rem is the usable width of the two columns
- ar5iv's right gutter: `.ltx_note_outer` shows only at `@media (width >= 96rem)` (`float: inline-end; padding-inline-end: 3rem; position: relative`), with widths hard-coded per breakpoint: `96rem < width <= 109rem` is `width: 20rem; margin-inline-end: -24rem`, `> 109rem` is `27rem / -31rem`; `< 96rem` is `display: none`, popping up on `:focus-within`. `.ltx_note.ltx_role_footnotetext .ltx_note_outer { position: absolute; inset-inline-start: var(--main-width-margin) }` (`--main-width-margin: 54rem`, used in this one place on the whole site)
- `.ltx_pubnotes.ltx_pubnotes_meta .ltx_pubnotes_content { float: inline-end; width: min(27rem, calc((100vw - var(--main-width)) / 2 - 2rem)); margin-inline-end: calc(1rem - (100vw - var(--main-width)) / 2) }`; `.ltx_note.ltx_note_frontmatter.ltx_role_thanks` has the same width, `position: absolute; inset-inline-end: calc(1rem - (100vw - var(--main-width)) / 2)` (relative to the article box's right edge); the author area `.ltx_authors ... :last-child.ltx_role_affiliation / .ltx_role_address { position: absolute; width: min(var(--main-width), 100dvw); inset-inline-start: max(0px, calc((100dvw - var(--main-width)) / 2)) }`. All four groups assume a centred article with gutters of equal width on both sides
- The theme's `@media (max-width: 1279px)` turns the navigation bar into a `position: fixed` drawer (the same breakpoint at which `responsive.ts` switches to stack)
- `ltx_flex_size_N`: the share LaTeXML gives a flex figure's cell, `size_1` a full column, `size_2` half, `size_3` a third; the fixtures hold 21 size_1 and 13 size_2/3; a single-column flex figure (every cell size_1) is common for a table plus footnote (Table 1 of 2609.03768v1)

## 4. Reference file map (the modules of DESIGN.md §4)

The repositories are in `reference/` (git-ignored, read-only): kiss-translator@c95bd46, read-frog@9b44f82, FluentRead@536a819; added 2026-09-07: macos-vision-ocr@91a236a (MIT), ImageTrans_chrome_extension@ef11ca7 (GPL-3.0). The core modules borrow design ideas only.

| Module | Reference |
|---|---|
| `rules` / `extractor` | Read Frog `src/utils/host/dom/filter.ts` (the full set of block / inline node predicates), `dom/traversal.ts` (`walkAndLabelElement`), `translate/core/translation-walker.ts`. KISS `src/libs/rules.js` is a site-rule subscription system, not needed for v1 |
| `protector` (placeholders) | KISS `src/apis/trans.js` (`genSystemPrompt` / `genUserPrompt`, the placetag idea) and `src/libs/translator.js`; Read Frog `translate/html-attribute-markers.ts` (marker integrity check, `assertHtmlAttributeMarkerIntegrity`), `translate/translation-output-normalization.ts` |
| `renderer` | Read Frog `translate/core/translation-modes.ts` (the bilingual and translation-only paths), `translate/dom/translation-text-swap.ts` (the translation-only mode's source snapshot and verified rollback), `translate/dom/translation-insertion.ts`, `translate/dom/translation-cleanup.ts`; FluentRead `src/features/full-page-translation/content/renderer.ts`, `layout.ts` |
| Translation style presets | KISS `src/config/styles.js` (18 preset constants), `src/libs/style.js` (`builtinStylesMap`), `src/hooks/CustomStyles.js` |
| `scheduler` | FluentRead `src/features/full-page-translation/content/runtime.ts` (IntersectionObserver progressive translation, including targets without a layout box), `content/viewportStability.ts`, `src/services/translation/requestScheduler.ts`, `queue.ts`; Read Frog `src/utils/request/request-queue.ts`, `batch-queue.ts`, `retry-policy.ts` (the 429 back-off policy), `src/entrypoints/background/translation-queues.ts` |
| `providers` (LLM) | Read Frog `src/utils/providers/model.ts` (the AI SDK model factory), `src/entrypoints/background/llm-generate-text.ts`, `translate/api/ai.ts`; KISS `src/apis/trans.js` (the request assembly of `genOpenAI` / `genClaude` / `genGemini`) |
| `google-gtx` / `translateHtml` | Read Frog `translate/api/google-legacy.ts` (gtx), `translate/api/google.ts` (translateHtml); KISS `src/apis/trans.js` (`genGoogle` / `genGoogle2`), `src/config/api.js` (the endpoint table) |
| `chrome-builtin` | KISS `src/libs/builtinAI.js` (the wrapper and fallback around `Translator.availability` / `create`) |
| `image` (§15 image translation) | helper: `macos-vision-ocr/Sources/ocr.swift@91a236a` (`extractText` / `extractSubBounds`, the Vision call and the four-corner coordinates); overlay: `ImageTrans_chrome_extension/ImageTrans/getImage.js@ef11ca7`'s `renderTranslatedImageDOM` (:1607), `fitBoxFontSize` (:1535), `detectBackgroundColor` (:1405), `wrapLines` (:1924); viewport scheduling `startAutoTranslate` / `observeImage` / `processQueue` (:2780–2930); `background.js`'s `computeImageHash` (:115). Its `replaceImgSrc`, which swaps the img src, is not followed |
| `cache` | FluentRead `src/services/translation/cache.ts` (key normalisation, TTL, capacity cap, in-memory hot layer + Dexie), `src/app/background/handlers/translationCache.ts`; Read Frog `translate/in-memory-translation-cache.ts`; KISS `src/libs/cache.js`, `cacheDigest.js` |
| `config` | Read Frog `src/utils/config/storage.ts`, `migration.ts`, `migration-scripts/` (versioned migration functions) |
| UI / Shadow DOM | Read Frog `src/entrypoints/side.content/index.tsx`, `selection.content/index.tsx` (WXT `createShadowRootUi`); FluentRead `entrypoints/shadowBridge.content.ts` |
| WXT project configuration | Read Frog `wxt.config.ts`, `vitest.config.ts` |

## 5. Liveness of the free endpoints (2026-09-03)

| Endpoint | Status | Response format | Tags preserved |
|---|---|---|---|
| Google gtx `GET translate.googleapis.com/translate_a/single?client=gtx&dt=t&dj=1&sl=en&tl=zh-CN&q=…` | 200 | `{sentences:[{trans,orig,backend}], src, spell}`; with several sentences `sentences[].trans` has to be joined | **Preserved**. Sample: 5 void `<x id="n"/>`, paired `<t id="1">…<x id="2"/>…</t>` nested; every id present with none added, nesting valid, positions sensible |
| Google translateHtml `POST translate-pa.googleapis.com/v1/translateHtml` | 200 | Request `[[[texts…], from, to], "wt_lib"]`, headers `Content-Type: application/json+protobuf` + `X-Goog-API-Key` (the public key built into KISS's configuration, see `reference/kiss-translator/src/config/api.js`); returns `[[trans…]]`, batching by nature | Preserved, but the semantic positions are poor (the first sample moved `<x id="1"/>` to the end of the sentence and `</em>` swallowed the full stop); translation quality clearly below gtx |
| Microsoft `edge.microsoft.com/translate/auth` → `translatetext` | auth 404, translation 401 | — | **This flow is gone**; re-measured 2026-09-08, see §5.1 for the unauthenticated successor |

### 5.1 Microsoft Edge `translatetext` (re-measured 2026-09-08, issue #98)

The old `translate/auth → translatetext` authentication flow is gone; the successor is an **unauthenticated** endpoint, and it is what Read Frog uses today too:

```http
POST https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false
Content-Type: application/json

["Hello world", "Good morning"]
```

The response corresponds one to one with the input, order preserved:

```json
[{"translations":[{"text":"你好，世界","to":"zh-Hans","sentLen":{...}}]}, …]
```

Measured (curl, 2026-09-08):

| Item | Conclusion |
|---|---|
| Availability | HTTP 200, no key / header needed, about 290 ms per call |
| **Total size cap** | **50,000 characters** (49,996 passed, 50,982 refused). The cap is on **total characters, not items**: 1000 items / 32 KB passed, 100 items / 52.6 KB refused |
| Over-cap response | HTTP 400, **the body is plain text** `Request exceeds the maximum allowed translation size.` — not JSON, so the implementation cannot `JSON.parse` it directly |
| Single-item length | A single item of 6000 characters passed |
| Language codes | BCP-47: `zh-Hans` / `zh-CN` / `ja` work; **ISO-639-3's `cmn` / `jpn` are always 400**. The repository already has `toBcp47()` (`src/config/languages.ts`) for this conversion, but **it covers the syntax only, not the supported range**, see below |
| Auto-detection | Omitting `from` auto-detects; the response gains a `detectedLanguage` |

**Supported range (decides whether the provider can be exposed to the user directly)**: `toBcp47()` only guarantees a syntactically valid tag, not that this endpoint supports it. Comparing its public language table (`api.cognitive.microsofttranslator.com/languages?api-version=3.0&scope=translation`, 138 languages) with our 179 target languages one by one: **108 supported, 71 not**.

The verdict must allow a **fallback to the primary language**, or it misjudges: the table has only `zh-Hans` / `zh-Hant` and no bare `zh`, yet `to=zh` measured 200 and normalised to `zh-Hans` — by exact match Chinese (our default target) would count as unsupported. Both directions measured: `zh` / `zh-Hant` / `zh-TW` / `ja` → 200; `ckb` / `ceb` / `tl` / `nn` / `eo` → **400** (the 400 body is plain text likewise).

**Correction 2026-09-09**: the 108/71 above was derived from the public table + “fallback to the primary language”, and **derived one too many**. Probing the endpoint with every one of the 179 tags `toBcp47` produces: **107 accepted, 72 refused**; none in the public table was refused, and the only ones accepted outside the table are 4 aliases — `zh`→zh-Hans, `zh-TW`→zh-Hant, `mn`→mn-Cyrl, `sr`→sr-Latn.

**One more, 2026-09-09**: the endpoint's own default normalisation **does not necessarily match our language meaning**. `toBcp47('srp')` gives bare `sr`, the endpoint normalises it to **`sr-Latn` (Latin script)**, while `languages.ts` describes `srp` as **Serbian (Cyrillic)** — a silent change of script, of the same kind as `ms-Arab`. So the provider side keeps a **rewrite table** (`zh→zh-Hans`, `zh-TW→zh-Hant`, `mn→mn-Cyrl`, `sr→sr-Cyrl`) that pins every target explicitly onto a real entry of the public table, and the verdict simplifies to “is the rewritten tag in the table”, with no inference by primary language. Measured: `sr-Cyrl` → Неуронске… (Cyrillic), `sr` → Neuronske… (Latin).

**CORS**: the endpoint measured returns `access-control-allow-origin: *`, so a background request succeeds without a host permission. But that is a dependency beyond our control — `https://edge.microsoft.com/*` has been added to `host_permissions` in `wxt.config.ts`, as for every other network engine.

The one that differs is `zlm`: `toBcp47` deliberately gives `ms-Arab` (Jawi), measured **400**; `ms` is 200 but returns Latin-script Malay, and normalising to it would silently change the script. **So the verdict can only be “exact match in the public table + measured aliases”, never inference by primary language** (Codex on #115).

**So the provider cannot be a code mapping alone**: it has to carry a support list and bail out early when the target language is unsupported (or grey the engine out on the options page), rather than discover it at a runtime 400.

**Placeholders**: the plain-text markers `@a#` all survived, and reordering happened — `The transform @a# is bounded by @b# in @c#.` → `变换@a#被@c#中的@b#界定。`, exactly what the marker scheme is for. The tag format is wiped out on it (all 400 placeholders lost, see the data on branch `experiment/sentence-alignment`), so it can only join the `markers` chain (DESIGN §8.5).

**Entities**: `&lt;` / `&gt;` come back as they were; **`&amp;` is translated as a word** (`Springer science &amp; business media` → `施普林格科学与商业媒体`).

**One line here I originally got wrong** (corrected 2026-09-08 while integrating, issue #98): I sent `a < b & c > d`, got back `A < B 和 C > D`, and wrote from that “a bare `<` is not parsed as HTML by it — it is not an HTML endpoint”. **Two upstream projects independently say this is wrong**:

> The endpoint runs Microsoft's HTML tag aligner on every request, so a bare `<` in page text fuses into a pseudo-tag (`a < b and c > d` comes back as `<B和C> d`) — Read Frog `api/microsoft.ts@9b44f82`

> Google and Microsoft **both parse the request as HTML**, so their adapters escape plain source text before sending and the response stays HTML-encoded; **decode it exactly once** — Read Frog `translation-output-normalization.ts@9b44f82`

> the endpoint always runs the HTML tag aligner — FluentRead `providers/translation/microsoft.ts`

My one sample simply did not trigger it (spaces on both sides of the comparison operators). The direction of the conclusion stands but its basis changes: `markers` escaping `& < >` uniformly (DESIGN §6.2) is not “safe” on the Microsoft side but **required**; `&lt;/&gt;` round-trip losslessly, `&amp;` becoming “与” is translation quality, not damage.

**What it means for DESIGN.md**: `microsoft` can be integrated as a free provider with `wireFormats: ['markers']` (#98). `maxBatchChars` should be far below 50,000 (Google uses 8000); `maxBatchItems` has no practical bottleneck.

**What it means for DESIGN.md**: gtx preserved the placeholders reliably in the samples, so `google-gtx` can conditionally declare `preservesMarkup: true` and take the markup path, with the validator as the safety net (falling back to runs on failure); translateHtml is not worth a provider of its own. See §7.

## 6. Chrome's built-in Translator API (2026-09-03, Chrome 152, macOS)

Probe script `scripts/phase0/translator-probe.js` (run this time through Claude in Chrome in the main world of the `arxiv.org/html/2410.00260` page, same logic).

### 6.1 Availability and user gestures

| Step | Result |
|---|---|
| `'Translator' in self` / `'LanguageDetector' in self` | both `true`; `isSecureContext` true |
| `Translator.availability({en→zh})` initially | `downloadable` (en→ja / de / fr / zh-Hant / ko `downloadable` likewise; language packs download per language pair) |
| `create()` without a gesture (model not downloaded) | throws `NotAllowedError: Requires a user gesture when availability is "downloading" or "downloadable"` |
| `create()` with a gesture (simulated click, `navigator.userActivation.isActive === true`) | succeeds, taking **66.9 s** (the language pack download); **during the download `availability()` kept returning `downloadable`, not `downloading`** |
| `create()` again after the download | 8.6 s; `monitor` received 15 `downloadprogress` events (`loaded` 0→1, `total` 1, i.e. normalised progress), so a second create still has a stretch of local loading |
| `create()` without a gesture once the model is ready | succeeds, 1 ms; `availability()` is `available` |
| `LanguageDetector.availability()` | `available` |

**Conclusion**: a user gesture is needed only when a language pack has to be downloaded. The extension's `isAvailable()` should go by `availability()`: `available` → usable directly; `downloadable` → `create()` has to be called inside the popup's click handler to start the download, with progress shown to the user (`monitor` gives progress events only in a create after the download is complete; during the first download the progress events are empty, so an indeterminate “downloading” hint is needed).

### 6.2 Translation behaviour (model ready)

| Input | Time | Output |
|---|---|---|
| One plain-text sentence | 9 ms | 「当图表连接时，定理 1 的证明是微不足道的。」 |
| With `<a href="#x">`, `<em>`, `<x id="1"/>` | 15 ms | All three tags preserved, `href` and `id` as they were; the text inside the tags translated and lower-cased ("theorem 1") |
| 5 void placeholders | 19 ms | All preserved, order correct |
| Paired nesting a void | 15 ms | Nesting valid, ids present with none added |
| A four-sentence paragraph (about 90 words) | 18 ms | Translated sentence by sentence, readable quality; 「。 」 appears between sentences (a space after the full stop), needs normalising |
| `inputQuota` / `measureInputUsage()` | — | `null` / `0`, no quota-limit signal |

**What it means for DESIGN.md**: `chrome-builtin` preserved placeholders and HTML tags in every sample, so like gtx it can conditionally declare `preservesMarkup: true`, with the runs path only as the safety net after a validator failure; single-sentence latency 10–20 ms, far faster than any network engine, suited as the instant engine for the first screen inside the viewport.

### 6.3 Not covered

- ~~Whether the content script's isolated world exposes `Translator` likewise~~ **Measured (2026-09-05, Chrome 153)**: with a throwaway probe-only extension (no change to this project's sources) injecting a content script on `arxiv.org/html/*`, in the isolated world `'Translator' in self` and `'LanguageDetector' in self` are both `true`, `isSecureContext` is `true`, and `Translator.availability({en→zh})` is `downloadable` like the same page's main world (en→ja too). Web APIs really are unaffected by world isolation; `chrome-builtin` can be used directly in the content script.
- Language pack size not measured (Chrome exposes no byte count; `total` is always 1); the 67 s download corresponds to this machine's network, an order of magnitude only.

### 6.4 `Translator` exists in the service worker too (2026-09-05, Chrome 153, Playwright loading the current build)

Codex asserted on #50 that the MV3 background service worker does not expose `Translator`, and inferred that the background side's availability check always reports “unavailable”. Measured, the opposite:

| Context | `'Translator' in self` | `Translator.availability({ en → zh })` |
|---|---|---|
| background service worker | true (function) | `downloadable` |
| popup page | true (function) | `downloadable` |

The availability result in the worker agrees with the window contexts; `createStatusHandler` judging chrome-builtin's availability in the background is accurate. The boundary that still holds: there is no user gesture in the worker, so with the pack `downloadable` `create()` throws `NotAllowedError`, and the download entry can only live in the popup's click handler (DESIGN §8.4).

## 6.5 ~~The MV3 service worker is the root cause of the current delay~~ (2026-09-04) — **conclusion overturned, see §6.7 / §6.8**

> **This section's delay conclusion no longer holds** (2026-09-06). The 6.7–77 s cannot be reproduced on the current code (§6.7), a request in flight keeps the worker alive by itself (§6.8), and “Read Frog sends requests from the content side” was a misreading (§6.7). The method and the raw data stay on file; **the conclusions and the recommendations derived from them are superseded by §6.7 / §6.8 throughout**.

After a page load it takes tens of seconds before translation starts; measured layer by layer (logs in the content side's `[axt] start:`):

| Observation | Data |
|---|---|
| `axt:ping` round trip (the background answers one constant) | delivery 0–51 ms, SW age 0 s |
| The `axt:provider-status` right after (no network request; reads the configuration and checks for a key) | 6.7 s / 13.5 s / 77 s (cold worker), 4 ms (warm worker) |
| Of which inside the handler | 6663 ms (delivery 0 ms, return 13 ms) |
| Mid-translation | `Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received` |

On the same freshly started worker the first message takes 50 ms and the next 6.7 seconds, with no I/O at all inside the handler. Together with the "channel closed before a response was received" error this points at **the MV3 service worker being suspended / reclaimed while waiting**, unrelated to our code. The cache write scanning the whole store (§9) is a real defect and has been fixed, but it is not the root cause of this delay; the earlier judgement is withdrawn.

**How the reference projects get around it**: Read Frog puts the providers' `fetch` in the **content script** (`utils/host/translate/api/*.ts` called from the host content), with the service worker entirely off the request path. FluentRead has a `platform/http/runtime.ts` abstraction with a replaceable transport.

## 6.6 Google translateHtml free endpoint measured (2026-09-04, page context)

Endpoint and parameters as in Read Frog `utils/host/translate/api/google.ts`: `POST https://translate-pa.googleapis.com/v1/translateHtml`, `Content-Type: application/json+protobuf`, `X-Goog-API-Key` (a public constant), body `[[[items...], from, to], "wt_lib"]`.

| Batch | Time | Result |
|---|---|---|
| 2 items | 307 ms | all returned |
| 20 items | 183 ms | all returned |
| 60 items | 250 ms | all returned |
| 150 items | 556 ms | all returned |

Two key conclusions:

1. **Callable directly from the page / content-script context**; the response carries CORS (`response.type === "cors"`), no need to go through the background.
2. **Our placeholders come back as they were**: `Let <x id="1"/> be a <t id="2">connected</t> graph` → `让<x id="1"/>成为<t id="2">连接</t>图表`. Void and paired placeholders and their ids all intact, so it takes the **markup path**, `preservesMarkup: true`, with no runs safety net needed. DESIGN §8's preset of `google-gtx` as `preservesMarkup: false` needs revising.

For comparison: a 159-block paper took 190 s through the LLM; through this endpoint at 150 items a batch it takes about 1 s. The quality is machine-translation grade ("weights" rendered as "重量"), suited to large-batch regression tests and instant first-screen display, not to replacing the LLM for the final translation.

---

## 6.7 Where requests run: a content-side fetch is bound by CORS and by the local-network gate alike (2026-09-05; the “mixed content” attribution corrected 2026-09-06, see below)

**Method**: two local OpenAI-compatible endpoints identical except for their CORS headers (`/v1/chat/completions` with `Access-Control-Allow-Origin: *` and answering preflights; `/nocors/...` with no CORS header at all); a probe extension loaded through Playwright (`host_permissions` covering the endpoints) sends the same POST with an `Authorization` header from the **background service worker**, the **content script's isolated world** and the **page's main world**, with the server logging Origin, preflight and status. The probe lives in the session's temporary directory, not in the repository.

| Where it runs | Endpoint with CORS headers | Endpoint without CORS headers | Origin / preflight the server sees |
|---|---|---|---|
| background service worker | 200 | **200** | `chrome-extension://<id>`, **no preflight** |
| content script (isolated world) | 200 (an `OPTIONS` preflight first) | **`TypeError: Failed to fetch`** | the page origin (`http://localhost:8898`); the preflight goes out and fails on the missing CORS header |
| page main world | as the content script | as the content script | as above |

Then with the page swapped for a real `https://arxiv.org/html/...` and the endpoint kept at `http://127.0.0.1`: the page's fetch is `Failed to fetch` outright, **the request never left the browser** (the server log is empty), while the background is 200 as before.

**This was first written up as “mixed content blocking”, a wrong attribution** (Codex on #57; corrected with a follow-up measurement 2026-09-06): loopback is a *potentially trustworthy origin* in the spec, and an `https` page calling `http://127.0.0.1` **is not** mixed content. The control experiment added — `http:8901` and `https:8902` (self-signed certificate, `--ignore-certificate-errors`) on the same loopback host at once, both endpoints with `Access-Control-Allow-Origin: *`:

| Originating page | → `http://127.0.0.1:8901` | → `https://127.0.0.1:8902` | Received by the server |
|---|---|---|---|
| `http://127.0.0.1:8901` (local as well) | **200** | **200** | preflight + POST both arrived |
| `https://arxiv.org/html/...` | `Failed to fetch` | **`Failed to fetch`** | **not one** |

The first row rules out the certificate, the endpoint and CORS as explanations; in the second row `https` → `https` cannot be mixed content, yet it is blocked all the same. **What really applies is Chrome's gate on a public site reaching local addresses (Local Network Access)**, regardless of the endpoint's scheme.

Practical impact: **giving the local endpoint an https certificate does not get around it**. Reaching Ollama directly from the page side is a dead end; only the background gets through — an extension origin with `host_permissions` is not subject to this gate (in the same measurement the background was 200 on both endpoints).

**Conclusions**:
1. Under MV3 `host_permissions` does **not** lift the content script's CORS constraint: the content side's request carries the page origin and goes through a preflight, exactly like the page's main world (the behaviour since Chrome 85, official documentation at developer.chrome.com/docs/extensions/develop/concepts/network-requests).
2. The background's request carries the extension origin, goes through no preflight, and an endpoint without CORS headers works.
3. A public page cannot reach a local endpoint (**the local-network gate**, regardless of the endpoint's scheme, see the control experiment above): a local Ollama (`http://localhost:11434`) is **unreachable** from the content side and reachable from the background. The Ollama CLAUDE.md lists can, under the current architecture, only pass the options page's connection test (through the background), while the real translation (through content) is bound to fail — two paths behaving differently, exactly the problem issue #42 points out.
4. For public APIs such as OpenRouter / DeepSeek, whether the content side can call them directly depends on the other side sending CORS headers to browsers for the long term, an external condition beyond our control; the background does not depend on it.

**An error in §6.5**: that section says “Read Frog puts the providers' fetch in the content script, with the service worker entirely off the request path”. Checking the reference snapshot: `utils/host/translate/translate-text.ts:360` sends the request to the background through `sendMessage("enqueueTranslateRequest", …)`, and `entrypoints/background/translation-queues.ts:490` queues it in the worker and really calls the model — Read Frog's requests **do run in the background**; only the waiting and the queue live there as well. The 6.7–77 s §6.5 measured **is the delay observed at the time**, but whether a “cold worker start” caused it was never verified (the worker state was not recorded, see the limitations of the re-measurement below), and it cannot be reproduced on the current code; the basis of the “how the reference projects get around it” passage does not hold either, and DESIGN §8.0's citing it as one of the reasons to move requests to content falls with it.

**Re-measuring the cold-start delay (2026-09-05, Playwright + the current main build)**: timing `axt:ping`, `axt:provider-status` (cold / warm) and `chrome.storage.local.get` from the popup page, four rounds (after start-up + three times after 36 s idle) all land in **0–5 ms**:

| Round | Workers alive before | ping | provider-status cold | warm | storage |
|---|---|---|---|---|---|
| after start-up | 1 | 5 ms | 1 ms | 1 ms | 0 ms |
| idle 36 s ×3 | 1 / 1 / 1 | 1 ms | 1 ms | 0–1 ms | 0 ms |

Two conclusions: (1) the path `getConfig()` + `getProvider()` + `isAvailable()` has a **steady-state cost of about 1 ms**; the 6.7–77 s §6.5 saw is not the code's own cost; (2) **in the Playwright environment the worker is never reclaimed** (after three idles the alive count is still 1 — a service worker with a debugger attached is exempt from MV3's idle reclamation), and CDP's `ServiceWorker` domain is unavailable on a browser-level session too, so §6.5's kind of “cold worker” **cannot be produced** here, and the three-way split cannot be completed in an automated environment. **Re-measuring the cold start in real Chrome (2026-09-06, Chrome 152, the user's browser, driven by Claude in Chrome, build `c24ebbd`)**: close every page of the extension, idle 40 s (beyond MV3's 30 s idle reclamation), reload the paper page and read the content log. Under the current architecture the only message content sends to the background on the start-up path is `axt:cache-get`, so the time for “all 13 blocks hit the cache” is the upper bound of **one message round trip on a cold worker + an IndexedDB read**:

| Round | `start: ready` | `session idle` (all 13 blocks cache hits) | cache-read timeout warning / channel closed |
|---|---|---|---|
| first load (warm) | 33 ms | 1633 ms (13 requests, 1 hit, through google-web) | none |
| idle 40 s #1 | 4 ms | 77 ms | none |
| idle 40 s #2 | 22 ms | 81 ms | none |
| idle 40 s #3 | 21 ms | 77 ms | none |

**This table does not measure a cold start; do not use it as one** [to verify] (Codex on #57 / #78, two rounds): it did not observe directly before each reload whether the worker had really been reclaimed — 40 s idle **exceeds** MV3's 30 s threshold, but Chrome may postpone reclamation and extension API activity resets the idle timer too, so these 77–81 ms may well be warm-worker numbers. The worker ages §6.8 records (45 013 ms / 90 007 ms, equal to the request durations) only prove that **reclamation does happen on that machine**: that was another 12-line probe measuring survival during a slow fetch, **not this extension's initialisation, configuration read and chain-building path**.

So the only thing this table supports is: **a steady-state (warm worker) round trip of 80 ms**. “A cold worker is only a little slower” is a guess with no measurement behind it, and this section no longer asserts it — to establish it, the extension's own background would have to mark worker creation and measure the full round trip of the first message after a restart.

Three **reloads after idling** (worker cold or warm not directly observed, see above) all had background round trips within 80 ms, and the 1.5 s cache-read budget never fired. **The 6.7–77 s §6.5 recorded cannot be reproduced on the current code** — that measurement was made on the version whose cache write still scanned the whole store (fixed, §9), and `provider-status` went through the background then, whereas the start-up path does not pass through it at all now. So the **latency** reason of §8.0's “move requests to content” does not hold (once more: this is “cannot be reproduced”, not “the cold start has been proven fast”); its **CORS / local-network gate** cost is confirmed by this section's measurements. The popup path was confirmed by hand by the user (2026-09-06): clicking the extension icon after idling, the “翻译” button is **clickable at once**, with no greyed-out seconds — `axt:provider-status`, the one start-up message still going through the background, did not stall in this observation either. **Note that this section measured the “start-up” round trip only**; it does not answer “is the worker reclaimed while a request is waiting” — another failure mode, and DESIGN §8.2's 35 s budget for a 1000-character batch and 120 s cap per attempt land exactly on that question (Codex on #57). §6.8 measures it specifically.

**Found along the way (the same measurement)**: the user's Chrome held a v7 configuration (from an earlier build of the settings-page branch) while the loaded build was v6; `@wxt-dev/storage` reported `Version downgrade detected (v7 -> v6)` and refused to migrate, `getConfig()` failed validation and fell back to the defaults — the API key silently ignored, the chain down to google-web, and nothing for the user to see. This is the same class of problem Codex pointed out on #52, “one term makes the whole configuration fall back”, with the trigger changed to “an older build installed”. Worth a line in DESIGN §9: a fallback to defaults must at least be announced in the popup, never silent.

## 6.8 The MV3 worker survives long requests in flight; no keep-alive needed (2026-09-06, Chrome 153, the user's browser)

**Why measure it separately**: §6.7 only measured the **start-up** round trip (77–81 ms), while the `A listener indicated an asynchronous response by returning true, but the message channel closed` §6.5 records is another failure mode — the worker reclaimed while a request **has been sent and is waiting**. The two cannot vouch for each other, and whether moving translation back to the background (issue #42) holds rests entirely on the latter. In Playwright the worker is pinned by the debugger and never reclaimed (recorded in §6.7), so it can only be measured in real Chrome.

**Method**: a probe extension of 12 lines (session temporary directory, not in the repository), `host_permissions` covering the local endpoint. A local HTTP service whose `/slow?ms=N` answers after N milliseconds; the content script asks the background with a one-shot `chrome.runtime.sendMessage` to fetch it, **with no keep-alive of any kind**, after first leaving the worker to go idle. The debugger is attached to the page only, not to the worker.

| Delay | Result | Duration | Worker age |
|---|---|---|---|
| 45 s | OK | 45 063 ms | 45 013 ms |
| 90 s | OK | 90 052 ms | 90 007 ms |

Both rounds far exceed MV3's 30 s idle reclamation threshold, and the response came back to content as usual. **Conclusion: a request in flight keeps the worker alive by itself; no Port and no heartbeat needed**.

**This conclusion covers only one kind of waiting, “a fetch in flight”** [to verify] (Codex on #78): after a 429 `RequestQueue` lets that fetch end normally and the task hangs on a `setTimeout` waiting for the back-off (`Retry-After` or exponential) — in that window **there is no active request**, while the whole-flow budget runs up to 180 s, far beyond the 30 s threshold. Nor did this probe distinguish whether it is “the sendMessage content is still holding” or “the active fetch” that keeps the worker alive. To cover that stretch the probe would have to become “the background waits N seconds after receiving the message before it fetches”. The safety net for now: a real problem would show as that batch timing out and failing, with the fallback chain and retries working as usual, never the whole page stuck. The two prepared variants (a session-long `chrome.runtime.connect`, a ping every 20 s) need not be enabled. The cause of §6.5's error did not recur; it may have come from the long blocking of the cache write scanning the whole store at the time (fixed, §9).

**Measured along the way: `Translator.create()` in the background**. §6.4 established that the worker has `Translator` and its `availability()` agrees with the popup; the `create()` step had not been tested. This time the probe read `downloadable` in the worker (the language pack was not ready in that Chrome configuration), **so `create()` could not be tested** and stays unknown. It does not block the move: `buildChain` drops engines whose `isAvailable()` is false from the chain anyway, so with the pack not downloaded `chrome-builtin` simply takes no part; a real download can only be started by the popup's click gesture (§6.1). To be measured when a language pack is ready some time.

## 6.9 The optional host permission's prompt cannot be clicked in Playwright (2026-09-06)

Hit while writing `pnpm e2e:local-endpoint`: saving a custom endpoint on the options page calls `chrome.permissions.request({ origins })`, Chrome shows a **native dialog**, Playwright can neither see nor click it, and `evaluate` hangs for good (measured twice; the process had to be killed by hand). With or without a user gesture alike.

The way around: the e2e **copies** `.output/chrome-mv3`, adds `http://127.0.0.1/*` to the copy's `manifest.json` only, and `--load-extension`s the copy; the repository's `wxt.config.ts` is untouched. The permission flow is not what that e2e tests.

Two things directly relevant to Ollama support were confirmed along the way (the probe calling `chrome.permissions.contains` in an extension page):

| Pattern | `contains` with `http://127.0.0.1/*` in the manifest |
|---|---|
| `http://127.0.0.1/*` | true |
| `http://127.0.0.1:8899/*` | **true** (a pattern with a port is valid and is covered by the one without)|
| `http://localhost:11434/*` | false (`localhost` and `127.0.0.1` are different hosts)|

So the port-carrying pattern the options page builds with `${new URL(url).origin}/*` is valid, and Chrome judges containment correctly.

## 6.10 Survey of existing browser image-translation solutions (2026-09-07, before starting)

DESIGN §15 records only the two used (`macos-vision-ocr`, `ImageTrans_chrome_extension`). The ones not used are recorded too; choosing a cross-platform recognition backend (issue #91) will need them:

| Project | Licence | Recognition | Where the boxes come from | Why not this round |
|---|---|---|---|---|
| [bytefer/macos-vision-ocr](https://github.com/bytefer/macos-vision-ocr) | MIT | Apple Vision | normalised corners + confidence | **Used**: the helper's core (§15.4) |
| [xulihang/ImageTrans_chrome_extension](https://github.com/xulihang/ImageTrans_chrome_extension) | GPL-3.0 | in-browser PaddleOCR (onnxruntime-web) or a local ImageTrans service | real OCR boxes | The overlay rendering and viewport scheduling ideas **were used**; the recognition was not — on a Mac Vision is more accurate and faster with no model to bundle. **Its "OpenAI" path does not send the image to the model**: in `ajaxOpenAI`, `boxes = await paddleOCR(dataURL, …)`, and the model only translates the recognised text |
| [Kuju29/TextPhantomOCR_Overlay](https://github.com/Kuju29/TextPhantomOCR_Overlay) | unspecified | Gemma 3 (Hugging Face) / Ollama reading the image | the docs never show it asking for coordinates, nor how the overlay is positioned | No licence, no coordinate implementation to port; only circumstantial evidence that "someone did this" |
| [A9T9/Copyfish](https://github.com/A9T9/Copyfish), SkyN9ne/CopyfishOCR | GPL | the ocr.space cloud API | real OCR boxes | Paper figures would go to a third party and need another key, the opposite of the "recognition stays local" trade-off |
| Honyaku Translation Overlay | — | Google Cloud Vision + DeepL | real OCR boxes | As above, and two sets of keys |
| [boysugi20/python-image-translator](https://github.com/boysugi20/python-image-translator), Crivella/ocr_translate | — | EasyOCR / local models, Python | real OCR boxes | Desktop / server programs, not in-browser; ocr_translate needs its own Django service |

**Conclusion**: there is no ready implementation of "a multimodal LLM reads the image and returns normalised boxes" to port; that route has to be written (about a day, see #91); the only ready cross-platform solution with accurate boxes is ImageTrans's in-browser PaddleOCR, at the cost of about 65 MB of models / wasm and a few seconds of CPU per image.

**The in-browser PaddleOCR's size, measured** (`reference/ImageTrans_chrome_extension/ImageTrans/paddleocr/`): `rec.onnx` 20 M, `ort-wasm-simd-threaded.jsep.wasm` 25 M, `PP-OCRv6_det_small.onnx` and `opencv.js` 9.5 M each, `model.onnx` 10 M; the loading and inference glue `page-ocr.js` is 779 lines.

## 6.11 SVG figures drawn with `<use>` glyphs need no OCR; the rest still do (2026-09-09, survey before starting issue #121)

**Population.** This section is about **externally referenced figures**, `<object type="image/svg+xml">`. That
is a different population from the inline `svg.ltx_picture` (TikZ) elements measured in §2.9, and the two do
not generalise to each other — §2.9's conclusion that inline SVG carries no translatable DOM text still
stands for inline SVG.

[Correction 2026-09-12: this no longer holds — DESIGN §15.6 wires the inline pictures' `foreignObject` labels into the image pipeline.]

**Sample.** Recent papers from eight arXiv categories: 178 with an HTML version. **99 of them (55.6%) carry
at least one SVG figure**, and counting figures rather than papers, **880 of 1792 (49.1%) are SVG** against
912 bitmaps. Of those 880 the crawl fetched the first four `<object>`s of each paper — 48 of the 99 papers
carry more — which resolve to **316 distinct assets, and all 316 were measured**, over two channels: **276
fetched and parsed over HTTP**, cached locally one directory per paper, and the 40 that answer 406 to curl
(see below) read in a real browser through their `<object>`'s `contentDocument`, which is what the extension
will actually see. **The coverage and encoding counts** — how many `<use>` elements there are, how many carry
`data-text`, what other text-bearing elements exist, and the angle distribution — **are the sum of the two, so
their denominator is the whole sampled set** rather than the part curl could reach (Codex asked on #133 for
the 406 group to be counted, not set aside). Everything else in this section names the population it was
measured on, because several were narrower: the ancestor-transform check is the 276 fetchable files only, the
dropped-space analysis 71 figures, the reachability pass 44, and the viewBox-to-element-box mapping three.

**276 fetchable files, not 281.** The crawl logged 281 non-error asset references but only 276 distinct
paths: five files are referenced twice within the same paper and were counted twice, and the earlier totals
counted them twice as well. Every per-file and per-glyph count in this section is over the 276 distinct
files, which is also what re-scanning the local corpus reproduces. The 281 is corrected rather than kept
alongside, so there is one denominator and not two.

**The headline holds only where glyphs are drawn as `<use>`.** That is every figure that draws them at all,
but 10.1% draw letter outlines straight into `<path>` instead, and nearly a third of those carry real words
that no amount of `data-text` reading will reach — see point 4. OCR is what would serve them.

### 1. `data-text` is reliable — coverage of real glyphs is 100%

| | over HTTP | 406 group, in browser | all |
|---|---|---|---|
| files measured | 276 | 40 | **316** |
| `<use>` elements | 54361 | 3684 | 58045 |
| carrying `data-text` | 54344 | 3684 (**100%**) | 58028 (**99.97%**) |
| — of those files, drawing glyphs as `<use>` at all | 249 | 35 | 284 |
| files where every `<use>` carries it | 244 | 35 | **279 / 284 (98.2%)** |
| files where some do | 5 | 0 | 5 |
| **files where none do** | 0 | 0 | **0** |
| files with no `<use>` — see point 4 | 27 | 5 | 32 |

The file rows are counted against the 284 that draw glyphs as `<use>`, not against all 316. The other 32
draw their outlines directly and have nothing for those rows to be true or false about; folding them into the
denominator would report 88.3% and read as though 12% of files were partially covered (Codex on #133).

All seventeen exceptions are `<use xlink:href="#pattern_tile_N">` — hatch-fill tiles, not glyphs, and all
seventeen are in the HTTP group; the 40 read in the browser contain no non-glyph `<use>` at all. **Coverage of
actual glyphs is 100%, on every asset the survey sampled.**

**No text lives outside the glyphs — checked on every asset, not on a sample.** Not one file has a `<text>`
element or a `<tspan>`, and **not one has a `<foreignObject>`**: 0 of 316, across both channels. Each half was
measured through its own channel — the 276 fetchable files parsed off the local corpus, the 40 curl cannot
reach read in the browser through `contentDocument` — and the two together are the whole set. An earlier
revision rested the `<foreignObject>` claim on an in-browser pass over 84 figures plus those 40, at most 124
of the set, while stating it as though it held everywhere; Codex asked on #133 for the rest, and the rest
agrees. So the "HTML labels inside SVG" representation §2.9 records for inline TikZ does not occur here, and
`data-text` really is the only channel — that check is what makes the claim sound, not the absence of
`<text>` alone.

**The id suffix is not a usable fallback.** A suffix like `font_2_99` equals the codepoint in only 21.83% of
cases (12283/56257 over both channels), and bimodally by file: 67 files where it always does, 209 where it
never does (there it is a font-internal glyph index), 8 mixed — 284 files, the ones that draw glyphs as
`<use>`. Issue #121's observation on three files holds on the larger sample.

### 2. Spaces are mostly explicit glyphs, so word segmentation is not the main problem

Space characters are drawn like any other: **788 of 10820 glyphs (7.28%) across 71 figures** carry
`data-text=" "`. What that establishes is that a space is **emitted as a glyph rather than left implicit in
the layout** — it is a share of glyphs, not a share of word boundaries, so on its own it cannot say that no
boundary is missing one (Codex on #133). Read directly off a run, the concatenation does come back whole:
`"Number of terms N"`, character for character. How often a boundary is missing its space is the paragraph
below, measured on the gaps themselves rather than inferred from this ratio.

**Not always, though, and the exception is measured below rather than assumed.** Runs whose internal gaps
include one about two advances wide — the shape a dropped space leaves — occur in **48.4% of code runs
(30/62)** and **11.5% of prose runs (42/365)**. The two populations are not alike: every prose hit inspected
is kerning around a symbol rather than two words run together (`T=0.2MeV`, `4-point-term`, `") (GeV"`), and
that detector cannot tell the two apart, so 11.5% is an upper bound on suspicion and not a rate of damage.
Every *observed* word-level failure — `iflog_counting`, `staticint` — is in code.

So: word boundaries do not have to be derived for the common case, and for the case where they do, see (b)
below (Codex asked for this to be measured across the sample rather than generalised from one figure, on #133).

### 3. The hard part is segmentation, and it comes in two kinds

**(a) Line and label boundaries.** The converter emits no *semantic* grouping: ticks, axis titles and legends
arrive in document order with nothing marking where one label ends, so they run together as
`"110100Number of terms N1015..."`.

A prototype confirmed geometric grouping works. Decompose `transform="matrix(a,b,c,d,e,f)"` into an angle
`atan2(b,a)` and a size `hypot(a,b)`, project along the baseline, and cut on gaps. It separated the labels on
the first attempt:

```
   0°  25px ×17  "Number of terms N"      ← axis title
   0°  20px × 3  "100"                    ← tick
 -90°  17.5px× 1  "R"                     ← rotated y-axis label
   0°  16px ×16  "Ei-series, xa=50"       ← legend
```

Superscripts separate onto their own baselines, which is right for `10^15`. **Rotation must come out of that
decomposition** rather than from reading `a` as the size.

**That decomposition reads one matrix, so it is only right if nothing above the glyph is transformed — and
nothing is.** Over all 276 fetchable files and 54344 glyphs, **not one glyph sits under an ancestor carrying
a `transform`**, and no root `<svg>` carries one either. A glyph's own `matrix(...)` is therefore the whole
transform from its coordinates to the figure's. Were a `<use>` ever nested under a transformed `<g>`, reading
its matrix alone would compute the wrong baseline, angle and size and put the label somewhere arbitrary.
That last check is the fetchable channel only — 276 of the 316 files, 54344 of 58028 glyphs; the 40 read in
the browser were measured for glyph coverage, `<foreignObject>` and angles, but not for nesting.

**The reason is not that the tree is flat, because it is not.** An earlier revision of this section said the
converter does no grouping at all, on the strength of a single 159-glyph figure that happened to be flat;
Codex questioned that sample on #133, and over the same 276 files **21.1% of glyphs (11467) are not direct
children of the root `<svg>`**, nested up to four deep:

| depth below root | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| glyphs | 42877 | 6766 | 3036 | 1599 | 66 |

Grouping happens; what does not happen is a transform on any of those containers. The implementation now
enforces that rather than assuming it: `src/core/svg/glyphs.ts` (commit `fb877e1`, merged with #134)
skips any glyph with a transformed ancestor, so a figure that ever did nest one would go untranslated instead
of being drawn from half a transform. (Forward reference — that is the implementation; this PR is the survey
and carries no code.)

Angles over the **whole sampled set** — all 284 glyph-bearing files, 58028 glyphs:

| | | |
|---|---|---|
| 0° | 52387 | 90.279% |
| -90° | 4906 | 8.455% |
| +90° | 62 | 0.107% |
| **42 other values** | **673** | **1.160%**, commonest -30° |

(The first version of this table omitted the +90° row and totalled 99.89%, leaving 62 glyphs unexplained —
Codex noticed the arithmetic on #133. Both quarter turns are handled; it is the last row that is dropped.
The counts came down from 58731 when the five duplicated files went out of the denominator, see **Sample**;
the shape did not move.)

A seven-paper sample of 10465 glyphs contained only the first two, and this section previously concluded
there were only two. There are not (Codex caught this on #133).

**Recommendation for v1: place the quarter turns, drop the rest — a scope decision with a measured cost, not
a claim that other angles are impossible to place.** An arbitrary angle is representable: a run already
carries its four corners, rotated with the text, so the placement information is there. What is missing is an
overlay layout that consumes it. The overlay describes a label as the axis-aligned bounding box of those
corners plus an angle, and `labelStyle` renders the angle by swapping width for height and `cqw` for `cqh`.
That swap is exact at a quarter turn and only there: off one, the bounding box is larger than the text — at
30° much larger — and `cqw`/`cqh` stop corresponding to the label's own axes, so the label would be drawn at
the wrong size across the plot. Supporting other angles means a layout that positions and sizes a label along
its own axes instead. That is a piece of work, not a barrier; v1 does not need it and this survey does not
promise it.

**What the decision costs is the last row of the table above: 673 glyphs, 1.160% of 58028, commonest -30°.**
(Forward reference — `quarterTurn` in `src/core/svg/glyphs.ts` is where the decision now lives, merged with
#134; this PR is the survey and carries no code, and Codex asked twice for forward references to be marked
as such.)

**(b) Spaces that were dropped.** In a syntax-highlighted code listing, `if` and `log_counting` belong to
differently coloured spans and the space between them has no glyph, so the run reads `"iflog_counting == 8:"`,
`"staticint"`.

**This cannot be decided from gap size.** Gaps between two non-space characters have a median of 0.553 of the
font size; gaps involving an explicit space glyph have a median of 0.550 — the same, because a monospace
advance does not depend on what it is advancing past. The usable signal is a **double-width** gap (non-space
gaps run to p95 = 0.818 and max = 1.12, about two advances), which needs a per-run advance estimate rather
than a global constant.

**The §5 skip rules do not reach it.** They select `.ltx_listing`, `code` and friends in the HTML; a listing
inside an externally referenced SVG is a bare sequence of `<use>` glyphs and matches none of them (Codex
pointed this out on #133). So the SVG path has to recognise code itself — from the shape of the runs, since
there is no markup left to go on — or it will send code for translation with its spaces missing. That is a
requirement on the #121 implementation, not something the existing rules give for free.

### 4. One figure in ten carries no readable glyphs, and nearly a third of those still carry words

32 of 316 files (10.1% — 27 from the HTTP group, 5 from the 406 group) have neither `<use>` nor `<text>`.
**They are not pure graphics.** An exporter can put letter outlines straight into `<path>`, and rendering
**all 32** shows that most of them do:

| | |
|---|---|
| no text at all — polyhedra, line diagrams, random walks | 11 |
| mathematics only — Feynman momentum labels, `Φ`, `x₁` | 10 |
| logos — a `K`, an `AI` wordmark | 2 |
| **word labels — legends (`revival`, `extinction`), block-diagram boxes, axis titles, `cw: clockwise`** | **9** |

The first three groups lose nothing by being skipped: `isTranslatable` rejects single-letter mathematics
anyway and a logo should not be translated. **The last nine are a real gap** — v1 leaves them untranslated
and cannot tell the reader why. They are the population an OCR fallback would serve, and they are the reason
that fallback is worth keeping rather than a hypothetical.

An earlier revision of this section called every file in this group pure graphics, then called them
mathematics and logos after inspecting four. Both were generalisations from a part of the set; Codex asked
twice for the whole set, and the whole set says something different from either.

### 5. `contentDocument` is reachable, and does not even need a scroll

Measured across four papers and 44 figures with explicit waits and `load` listeners: **44/44 reachable, all of
them already reachable before scrolling anything into view**. The 406-group pass adds **40/40 reachable**
across 23 further papers under the same explicit `load` wait. An earlier probe in this survey reported 19/27
for one paper; that probe raced its own measurement and the number is withdrawn.

This matters because it settles the fourth of issue #121's "what is actually hard" list. Combined with the
next point, nothing needs to be written into the embedded document.

### 6. viewBox coordinates map linearly onto the `<object>` element box

Comparing a glyph's position computed from the `viewBox` against where it actually renders, on three figures:

| predicted | actual |
|---|---|
| nx 0.1310, ny 0.9346 | nx 0.1339, ny 0.9346 |
| nx 0.1009, ny 0.9266 | nx 0.1037, ny 0.9264 |
| nx 0.1176, ny 0.9275 | nx 0.1203, ny 0.9275 |

`ny` agrees to four decimal places. The constant 0.0028 offset in `nx` is the glyph's left side bearing —
`e` is the origin, `rect.left` is the inked box — not an error in the mapping. arXiv sets `aspect-ratio` on
the `<object>` to match the viewBox, so nothing is letterboxed in practice.

**So an overlay can live entirely in the main document, reading the embedded one and never writing to it.**
That removes issue #121's fourth difficulty outright: §7.1's DOM invariant is untouched, `restore()` needs no
new semantics for embedded documents, and the nested browsing context problem shared with #109 reduces to
"can we read it", which point 5 answers.

### The 40 files curl could not fetch encode their text no differently

`https://arxiv.org/html/<id>/<file>.svg` answers **406** for some papers regardless of `Accept` or user agent,
and their `.png` assets do too — while the same figures render and read fine in the page. All 40, across 23
papers, were therefore read in a browser through `contentDocument`: **40/40 reachable, 3684 `<use>` elements,
3684 carrying `data-text` (100%), zero `<text>`, zero `<tspan>`, zero `<foreignObject>`**, and 5 files drawing
outlines directly with no `<use>` at all (12.5%, against 9.8% in the HTTP group). Rendering those 5 puts four
in "mathematics only" and one — `cw: clockwise` / `ccw: counterclockwise` — in "word labels".

So the 406 is a property of arXiv's asset serving and not of a different encoding; it affects crawling
surveys, not the product. This is why the tables above are totals over 316 distinct files rather than the 276
curl could fetch (Codex on #133).

### Revisions to issue #121

- "Grouping glyphs into semantic runs is the bulk of the work" — **not so**. Spaces are mostly explicit and
  document order is exact. The work is geometric line segmentation (verified feasible) and, only for code,
  restoring dropped spaces from a per-run advance estimate.
- "The id suffix is a usable fallback" — **not so**, 21.83%.
- "Survey coverage before building anything" — **`data-text` can be relied on** wherever glyphs are drawn as
  `<use>`, which is every figure that uses them — measured over all 316 distinct assets the survey sampled,
  not only the 276 curl could fetch. The 10.1% that draw outlines directly are the population a fallback
  would serve, and 9 of those 32 carry real word labels, so that fallback has a job rather than a
  theoretical one.

### Revision to DESIGN.md §15.1

§15.1 and §15 currently say v1 translates bitmaps only and skips SVG, on the strength of the §2.9 audit —
which counted **inline** `svg.ltx_picture` (TikZ) and did not look at externally referenced
`<object type="image/svg+xml">` figures at all. Those are 49.1% of the figures in the sample (880 of 1792)
and their text is exactly recoverable wherever it is drawn as `<use>` glyphs. **§15.1's "skip SVG" has to be narrowed to inline SVG**, and the external path
described as its own recogniser feeding the same overlay (Codex pointed out on #133 that leaving the DESIGN
table stale would let later work follow the obsolete requirement, since DESIGN is the source of truth).

---

## 7. DESIGN.md revision list

Ordered by section. Each entry is a suggestion only; whether it is adopted is the design document's decision.

Status as of 2026-09-12 (docs/rebuild/inventory/docs.md §5): **done** 1–5, 7–11, 13, 17–19, 22–27; **superseded by a better design** 6, 12, 14; **reversed by later evidence** 16 (translateHtml was adopted, row 23); **unimplemented, disposition unresolved** 21 (the instant engine was never built, yet DESIGN §8.3 lists it as decided — the rebuild has to either build it or strike the decision); **obsolete** 15, 20.

| # | Entry | Suggestion | Basis |
|---|---|---|---|
| 1 | §5 whole section [to verify] | The selectors were corrected against 10 fixtures, body coverage 99.97%; the [to verify] mark can go, revised as in the entries below | §2 |
| 2 | §5.1 `.ltx_abstract .ltx_p`, `.ltx_item .ltx_p`, `.ltx_theorem .ltx_p, .ltx_proof .ltx_p` | Entirely covered by `.ltx_p`, delete; if the prompt needs "abstract / theorem" context, make it a context mark rather than a block rule | §2.4 |
| 3 | §5.1 new translation units | `.ltx_acknowledgements`, `.ltx_keywords`; `.ltx_subtitle` folded into the title rule | §2.3 |
| 4 | §5.1 the tag name of `.ltx_p` | Note that `.ltx_p` may be a `<span>` (inside tables, inline-blocks); extraction and rendering go by class name, not tag name | §2.10 |
| 5 | §5.1 / §6.1 footnotes | Footnotes are nested blocks: `.ltx_note` whole is a void placeholder inside the paragraph, `.ltx_note_content` a block of its own; the `.ltx_note_mark`, `.ltx_note_type` inside it are voids | §2.5 |
| 6 | §5.2 `.ltx_author`, `.ltx_date` | Do not exist on real pages. Replace with `.ltx_creator, .ltx_personname, .ltx_author_notes, .ltx_role_affiliation, .ltx_dates`; keep `.ltx_authors`, `.ltx_contact` | §2.2 |
| 7 | §5.2 new skip rules | `.ltx_pubnotes` (publication metadata), `svg, .ltx_picture` (TikZ pictures), `.ltx_listing_data` (hidden code data) | §2.3 / §2.7 / §2.9 |
| 8 | §5.2 "the header / footer arXiv injects" | List no selectors; change to "nothing outside `article.ltx_document` is extracted"; the navigation bar `.ltx_page_navbar` is outside the root too | §3.1 / §2.10 |
| 9 | §5.3 numeric-cell regex | Add `(?=.*\d)` to fix the `ERROR`-type false positives; add the pure-symbol branch and `N/A`. Calibration data: 59% matched, 31% prose | §2.6 |
| 10 | §5.5 / §14 LaTeXML version branching | Only oxide 0.7.6 exists online (historical articles reconverted); several versions cannot be covered with real pages. Keep the probe function and the branching mechanism; change "fixtures cover several years" to "fixtures record the generator version, re-fetch when it changes" | §1 |
| 11 | §6.1 void node list | Confirm that `.ltx_ref` (with `.ltx_ref_tag`), `.ltx_cite`, `.ltx_note_mark` must be written into `latexml.ts` as rules, or they are treated as paragraph body (3,500+ elements in all) | §2.5 |
| 12 | §7.2 width: override the max-width of `.ltx_page_main` | Instead override the CSS variable `--main-width` on `html[data-axt-mode="side"]`; mind the knock-on effect of the enlarged variable on images, code blocks, cells and the ≥96rem margin-note positioning | §3.2 |
| 13 | §7.2 auto-fallback threshold 1100px | Change to 1280px, aligned with the arXiv theme's breakpoint | §3.2 |
| 14 | §7.2 scope of the grid technique | Works only for `.ltx_para > p.ltx_p`; `span.ltx_p`, inside tables and inside inline-blocks degrade to stack | §2.10 |
| 15 | §8.1 `google-gtx` preservesMarkup: false [to verify] | Measured on two sample sets: every placeholder preserved, nesting valid; suggested `true`, the runs path demoted to the safety net after a validator failure | §5 |
| 16 | §8.3 the idea of a new translateHtml provider | Usable, but translation quality and placeholder positions are worse than gtx; not recommended | §5 |
| 17 | §8.1 `chrome-builtin` preservesMarkup: false | Measured to preserve HTML tags and void / paired placeholders; suggested `true` as for gtx; `isAvailable()` goes by `availability()`, and when `downloadable` `create()` must be called inside a user gesture (popup click) to start the download; the first download has no progress events and `availability()` does not become `downloading`, so the UI shows an indeterminate state; the translation needs 「。 」 normalised | §6 |
| 21 | §8.3 default order of the fallback chain | `chrome-builtin` is 10–20 ms per sentence and offline; suggested: with the model ready, put it before the user's chosen LLM as the instant engine for the first screen of the viewport, replaced when the LLM result arrives (the cache key carries the provider, so the two do not clash); adoption depends on the trade-off against translation quality | §6.2 |
| 18 | §11 fixtures cover several years | Change to "cover several fields and structures"; the year is no longer a proxy for the version | §1 |
| 19 | §14 conflicts with arXiv's own JS | Measured: no conflict surface (no MutationObserver / MathJax / footnote JS; footnote pop-ups are pure CSS); the risk can be lowered to low | §3.3 |
| 22 | ~~§8 / §10 provider requests run in the background~~ | ~~Suggested moving the providers' fetch to the content script~~ **Withdrawn (2026-09-06)**: the three §6.5 conclusions it rested on are all overturned (§6.7 / §6.8), and “Read Frog sends requests from content” was a misreading. **Opposite in direction to row 24; row 24 governs**; the actual implementation moved to the background (issue #42, merged) | ~~§6.5~~ → §6.7 / §6.8 |
| 23 | §8 `google-gtx` uses `translate_a/single`, `preservesMarkup: false` | Use Read Frog's `translate-pa.googleapis.com/v1/translateHtml` instead: measured to preserve placeholders, `preservesMarkup: true`, a batch of 150 in 556 ms | §6.6 |
| 20 | ~~§15.1 text in SVG figures translated as ordinary blocks~~ **superseded by 27** | ~~Measured: SVG is all TikZ `svg.ltx_picture`, no `<text>`, very little foreignObject text. v1 skips SVG whole; the OCR route targets `img.ltx_graphics` only~~ That entry looked at **inline** SVG only — see 27 | §2.9 |
| 24 | §8.0 requests run in the content script | Measured: a content-side fetch is bound by CORS and by the **local-network gate** (§6.7): endpoints without CORS headers and local endpoints (Ollama; http and https blocked alike) are unreachable from content and reachable from the background; the connection test goes through the background and the real translation through content, two paths behaving differently. And the “Read Frog sends requests from content” §8.0 cites checks out as a misreading. Suggested: factor out the transport, run requests in the background by default (no CORS preflight, not subject to the local-network gate, the key never enters the page world), content keeps scheduling only; ~~re-measure the cold-start delay first as issue #42 asks, then decide~~ **re-measured** (§6.7 three rounds in real Chrome 77–81 ms, §6.8 long requests of 45 / 90 s both survived), **implemented as this entry says and merged** (issue #42) | §6.7 / §6.8 |
| 25 | §2 “Non-goals [deferred]” lists “the Microsoft free channel” as not for v1; §8.1's text says “gtx and the Microsoft edge channel are not integrated (the latter's auth endpoint is 404)” | **The basis has lapsed**: that auth flow is indeed gone, but its **unauthenticated successor** works today (§5.1). #104 has put the `markers` wire format and capability negotiation into main, and Microsoft is exactly why it exists. Suggested: change both places to “can be integrated, `wireFormats: ['markers']`”, and add a row to the provider table of §8.1 | §5.1 |
| 26 | §8.1's provider table has no “supported language range” column | The free engines do not support every target language: Microsoft measured 71 of 179 targets as 400. Suggested: the provider interface gains a “can this target language be translated” verdict, and `buildChain` and the options page filter by it rather than wait for a runtime error | §5.1 |
| 27 | Narrow §15.1's "skip SVG" to "skip **inline** SVG" | Externally referenced `<object type="image/svg+xml">` figures are a separate population, 49.1% of the 1792 figures in the sample. Their text is drawn as `<use>` glyphs carrying `data-text`, so it is read exactly rather than recognised, and needs no OCR. The 10.1% that draw outlines straight into `<path>` still need an OCR fallback | §6.11 |
