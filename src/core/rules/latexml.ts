// LaTeXML rules. All ltx_* selectors belong here (CLAUDE.md hard rule 2).
// Based on DESIGN.md §5.1 / §5.2 / §5.3 / §5.6 / §6.1; measurements in docs/RESEARCH.md §2.
// Data tables and pure functions only; traversal lives in src/core/extractor.

/**
 * Increment on behavior changes to any table / function; included in cache keys. 0.5.0: all cell depths, serialize units within cells (§5.3).
 * 0.6.2: named tags become translatable; plain identifiers such as (a) / (ii) stay protected. Classification semantics changed,
 * so old caches must not carry over (Codex #53).
 */
export const RULES_VERSION = '0.10.0'

/** LaTeXML class prefix, used to identify paper-body elements. */
export const LTX_CLASS_PREFIX = 'ltx_'

/** Translation root: exclude everything outside it, including navigation, arXiv headers / footers, and dialogs. */
export const DOCUMENT_ROOT = 'article.ltx_document'

export interface Rule {
  id: string
  selector: string
  note: string
}

/** descend: void to its outer unit, but may contain independent blocks such as footnotes; extraction must descend. */
export interface ProtectRule extends Rule {
  descend?: boolean
}

/** Translation units (§5.1): a match with translatable text becomes a block; descend to discover nested units. */
export const UNIT_RULES: readonly Rule[] = [
  { id: 'p', selector: '.ltx_p', note: 'Body paragraphs, possibly <span>; covers abstracts, lists, and theorem paragraphs' },
  // Run-in acknowledgement / keyword titles are not separate blocks: their containers already form units with bare body text.
  // A title block would become a void placeholder in the outer block, cloning its English text and producing two English titles
  // plus Chinese body text (2609.00095). Keeping it paired translates it with the container and restores it in place.
  { id: 'title', selector: '.ltx_title:not(.ltx_title_acknowledgements):not(.ltx_title_keywords), .ltx_subtitle', note: 'Headings, subtitles, and theorem run-in titles; contained .ltx_tag nodes are void' },
  { id: 'caption', selector: '.ltx_caption', note: 'Figure / table captions; contained .ltx_tag nodes are void' },
  { id: 'footnote', selector: '.ltx_note_content', note: 'Independent footnote-body blocks inside .ltx_note containers' },
  // Translate bibliography entries by .ltx_bibblock segment (§5.4). Since 2026-09-06, author segments are no longer skipped:
  // authors already translate with single-segment entries, so skipping made templates inconsistent (§5.4).
  // Entries without segments (e.g. natbib) fall back to one unit each.
  { id: 'bibblock', selector: '.ltx_bibblock', note: 'Bibliography segment: authors / title / source (§5.4)' },
  { id: 'bibitem', selector: '.ltx_bibitem:not(:has(.ltx_bibblock))', note: 'Unsegmented bibliography entry, one unit each' },
  { id: 'ack', selector: '.ltx_acknowledgements', note: 'Acknowledgements' },
  { id: 'keywords', selector: '.ltx_keywords', note: 'Keywords' },
  // Translate author metadata by default (§5.2 revision): affiliations, contacts, dates; protect mailto addresses separately.
  // Translate names too since 2026-09-06 (§5.2). The old objection was that transliteration breaks citation lookup,
  // but bilingual views keep originals beside translations. Only mode hides them, its inherent tradeoff for all content.
  { id: 'personname', selector: '.ltx_personname', note: 'Author-name span inside .ltx_creator; translated sibling is naturally inline' },
  { id: 'authorinfo', selector: '.ltx_contact, .ltx_role_affiliation, .ltx_role_address, .ltx_dates, .ltx_date', note: 'Author affiliations, contacts, and dates' },
  // Not seen in downloaded papers; guarded by tests/fixtures/arxiv/synthetic-structures.html (RESEARCH.md §2.12).
  { id: 'dedicatory', selector: '.ltx_role_dedicatory', note: 'Dedication' },
  { id: 'item', selector: '.ltx_item', note: 'Bare list-item / description-term text; p rule handles nested .ltx_p' },
  { id: 'marginal', selector: '.ltx_marginpar', note: 'Margin note' },
  { id: 'indexentry', selector: '.ltx_indexentry', note: 'Index entry; .ltx_indexrefs page numbers are placeholders' },
  { id: 'cv', selector: '.ltx_cv_item_label, .ltx_cv_item_content, .ltx_cv_entry_date', note: 'CV template entry fields' },
]

/** Tables (§5.3): outermost .ltx_tabular is one unit (no descent). Cells are segments within it; th also carries ltx_td. */
export const TABLE_RULES = { root: '.ltx_tabular', cell: '.ltx_td' } as const

/** Display-equation tables: single equations and align groups; tr.ltx_equation rows are not separate tables. */
export const EQUATION_TABLE = 'table.ltx_eqn_table'
/** Equation-table filler cells absorb width: 100% slack; ar5iv gives them min-width: 2em, used when measuring content width. */
export const EQUATION_PAD_CELL = '.ltx_eqn_center_padleft, .ltx_eqn_center_padright, .ltx_eqn_left_padleft, .ltx_eqn_right_padright'
/** Wide content fitted into side-mode columns (renderer/table-fit.ts): tables and display equations. */
export const FIT_TARGETS = `${TABLE_RULES.root}, ${EQUATION_TABLE}`

/** All table-block cells, in document order at any depth; nested tabular cells belong to the outer block too (§5.3). */
export function tableCells(table: Element): Element[] {
  return Array.from(table.querySelectorAll(TABLE_RULES.cell))
}

/** The protector needs to identify cell roots: descend into their units, which are not separate blocks (§5.3). */
export function isTableCell(el: Element): boolean {
  return el.matches(TABLE_RULES.cell)
}

/** Block-level skip (§5.2): neither emit nor descend. Within units (e.g. inline .ltx_ERROR), equivalent to void. */
export const SKIP_RULES: readonly Rule[] = [
  { id: 'equation', selector: '.ltx_equation, .ltx_equationgroup', note: 'Display equations including alignment tables and .ltx_eqn_cell' },
  { id: 'listing', selector: '.ltx_listing, .ltx_listingline, .ltx_listing_data, .ltx_verbatim, pre, code', note: 'Code, algorithm lines, verbatim, hidden code data' },
  // No longer skip all author metadata (§5.2); names translate since 2026-09-06 (UNIT_RULES personname).
  // Only separators remain excluded; separate blocks would break name lists into one word per line.
  { id: 'author-glue', selector: '.ltx_author_before, .ltx_author_after', note: 'Author separators (" and ", ", ")' },
  { id: 'classification', selector: '.ltx_classification', note: 'MSC / ACM classification codes, e.g. "Primary: 11L07"' },
  { id: 'pubnotes', selector: '.ltx_pubnotes', note: 'Publication metadata (ACM CCS / DOI / journal)' },
  { id: 'picture', selector: 'svg, .ltx_picture', note: 'TikZ graphics; no translatable text found in measurements (§15.1)' },
  { id: 'error', selector: '.ltx_ERROR, .ltx_FATAL, .ltx_WARNING, .ltx_INFO', note: 'LaTeXML conversion errors / notices, not paper content' },
  { id: 'nav', selector: '.ltx_page_navbar, .ltx_TOC', note: 'Navigation / TOC outside the translation root; used by rendering to hide them' },
]

/**
 * Named tags: LaTeXML includes environment names for theorems, figures, algorithms, and appendices in .ltx_tag.
 * Protecting all tags left "Definition 1.1." in English for Chinese readers (user report, 2026-09-05).
 * Translate these names; all other tags are identifiers / symbols and must remain unchanged.
 *
 * Measurements from all 12 fixtures (1,241 .ltx_tag nodes):
 * all 246 theorem tags resemble "Definition 1" / "Example 1"; all 43 table tags are "Table 1:";
 * 58 of 63 figure tags are "Figure 1."; all 20 appendix tags are "Appendix A"; all 13 float tags are "Algorithm 1";
 * one part and one chapter tag. Conversely, only 13 of 344 equation tags contain letters (LaTeX labels such as "(let.lin)", which must stay unchanged),
 * lettered tags among 439 section / subsection / ref tags are Roman numerals (II, III.1); 54 note tags are footnote markers.
 *
 * Class names alone are insufficient: .ltx_tag_figure also labels panels with plain identifiers (a), (b), (c),
 * five of 387 named tags in 2410.00260 and 2312.17141 (Codex #53).
 * Translating can rewrite / reorder these and break panel correspondence. Require actual words as an additional check.
 */
export const NAMED_TAGS = [
  '.ltx_tag_theorem', // Definition 1.1 / Theorem 2 / Lemma 3
  '.ltx_tag_figure', // Figure 1.
  '.ltx_tag_table', // Table 1:
  '.ltx_tag_float', // Algorithm 1
  '.ltx_tag_appendix', // Appendix A
  '.ltx_tag_part', // Part I
  // Description-list terms (\item[Compactness]) are tags too, and are real body content (Codex #18).
  // Without this exception, .ltx_item has no own text and never becomes a block, leaving terms untranslated. Of 371
  // .ltx_tag_item nodes across 12 fixtures, only eight contain words (Markov categories: / CD categories: / Compactness. / RQ1–RQ5).
  // Content checks below exclude the other 363 markers such as (1) / •. google-web returned RQ1 unchanged in measurements,
  // preserving its identifier.
  '.ltx_tag_item', // Compactness. / Markov categories:
  '.ltx_tag_chapter', // Chapter 1
].join(', ')

/** Protected inline nodes (§6.1): void placeholders, not blocks; do not descend by default. */
export const PROTECT_RULES: readonly ProtectRule[] = [
  { id: 'math', selector: 'math, .ltx_Math', note: 'Inline math; display math is already skipped by equation' },
  { id: 'ref', selector: '.ltx_ref', note: 'Cross-references including nested .ltx_ref_tag' },
  { id: 'cite', selector: '.ltx_cite', note: 'Citation markers' },
  { id: 'tag', selector: '.ltx_tag', note: 'Section / equation / list / footnote / code-line markers; named tags excluded via isNamedTag' },
  { id: 'tt', selector: '.ltx_text.ltx_font_typewriter', note: 'Monospaced text treated as code' },
  { id: 'note', selector: '.ltx_note', descend: true, note: 'Void to the outer paragraph; nested .ltx_note_content must still be discovered as a block' },
  { id: 'note-mark', selector: '.ltx_note_mark, .ltx_note_type', note: 'Footnote markers / type labels, both outside and inside content' },
  { id: 'mailto', selector: 'a[href^="mailto:"]', note: 'Preserve email addresses unchanged' },
  // LaTeXML contact labels ("Affiliation: " / "Email: ") are display:none in arXiv CSS.
  // Otherwise a mailto .ltx_contact has only that hidden label to translate, yielding an invisible translated label
  // plus the unchanged address, visibly duplicating the email (§5.2 decision).
  { id: 'contact-label', selector: '.ltx_contact_name', note: 'Template-generated contact label hidden by site CSS' },
  // Citation years (Codex #74): after enabling author segments (§5.4), .ltx_bibblock sends years for translation too.
  // Paired placeholders preserve tags but allow content translation, so (2024) could gain fullwidth parentheses
  // or a localized year suffix; placeholder validation would accept it. Only mode hides the original,
  // leaving rewritten citation metadata. All 59 observed forms were <span class="ltx_text ltx_bib_year"> (2024)</span>.
  // These contain no translatable words; void protection is simplest.
  { id: 'bib-year', selector: '.ltx_bib_year', note: 'Citation year, preserved unchanged (§5.4)' },
  { id: 'indexrefs', selector: '.ltx_indexrefs', note: 'Page-number list following an index entry' },
  { id: 'img', selector: 'img', note: 'Inline image' },
  { id: 'br', selector: 'br', note: 'Line break' },
]

/**
 * Side-mode mirror targets (§7.2): untranslated block content occupying a full row.
 * The right column needs a copy too, or formulas / figures span both columns and disrupt reading.
 * Mirror graphics only, not entire figures: .ltx_caption is translatable,
 * so whole-figure mirroring would put English captions in the right column (observed). With a grid figure,
 * graphics / mirrors occupy one row and captions / translations the next, keeping both columns complete.
 * Exclude tables; their whole-table clone is already the translation (§5.3).
 */


export type RuleKind = 'skip' | 'table' | 'unit' | 'protect'

export interface Classification {
  kind: RuleKind
  /** Matched rule ID; always table for tables. */
  rule: string
  /** Whether extraction should descend to find nested blocks. */
  descend: boolean
}

const TABLE_CLASSIFICATION: Classification = { kind: 'table', rule: 'table', descend: false }

/** Classification priority (§5.6): skip > table > unit > protect; null when nothing matches. */

/** Parenthesized identifiers, including panel labels (a) / (ii) / (iii) and equation labels (let.lin). */
const PARENTHESIZED = /[(（][^)）]*[)）]/g

/**
 * Never translate Roman-numbered tags: engines localize their numbers, while protected .ltx_ref links retain the source,
 * breaking correspondence. google-gtx measurements, 2026-09-05 (Codex #53):
 *
 * | Source | Translation |     | Source | Translation |
 * |---|---|---|---|---|
 * | `Table IV:` | 表四： |  | `Table 4:` | 表 4： |
 * | `Table X:` | 表十： |  | `Appendix A` | 附录A |
 * | `Part I` | 第一部分 |  | `Appendix C` / `D` | 附录C / 附录D |
 *
 * Arabic numbers, letter IDs, and parenthesized panels stay unchanged; only Roman numerals are rewritten. Google treats
 * I / V / X / L / M as numbers but standalone C / D as letters; match that behavior. Numbering style is consistent within each paper,
 * so readers do not see a mixture of localized Arabic-numbered tags and English Roman-numbered tags.
 */
// Compound IDs count too: Table IV.1: ends in IV.1, Theorem IV-A in IV-A; a Roman first component is localized.
// Measured google-gtx on 2026-09-05: `Table IV.1` → 表四.1. LaTeX \roman emits lowercase, which is localized too
// (`Table iv:` → 表四：, `Theorem ii.3` → 定理二.3), so match case-insensitively (Codex #53).
const ROMAN_ID = /^(?:[IVXLCDM]{2,}|[IVXLM])(?:[.\-–][A-Za-z0-9]+)*$/i

/**
 * Named tags containing words: translate Definition 1.1, but never panel identifiers (a) / (ii).
 *
 * Three steps: remove parenthesized content, check for at least two consecutive letters,
 * then exclude Roman-numbered tags (ROMAN_ID).
 * Letter count alone is insufficient: panels can use multi-letter Roman IDs such as (ii) / (iii) (Codex #53).
 * LaTeXML uses parentheses for identifiers, never environment names. Removing parentheses from Definition 1.2 (Hall set)
 * still leaves Definition and qualifies for translation.
 */
/**
 * Parenthesized words vs. identifiers: retain (Hall set) / (Figure 1), which contain non-Roman words;
 * remove identifier-only (a) / (ii) / (A.1). Removing every group would lose the environment name
 * in fully parenthesized tags such as (Figure 1), preventing translation (Codex #53).
 */
const hasNonRomanWord = (inner: string): boolean =>
  (inner.match(/[A-Za-z]{2,}/g) ?? []).some(word => !ROMAN_ID.test(word))

export function isNamedTag(el: Element): boolean {
  if (!el.matches(NAMED_TAGS)) return false
  const text = (el.textContent ?? '').replace(PARENTHESIZED, group => (hasNonRomanWord(group) ? group : ''))
  if (!/[A-Za-z]{2,}/.test(text)) return false
  // Final numbering token: Table XIII: → XIII. Remove punctuation before trimming: Table IV : leaves trailing whitespace after colon removal.
  // Without trim, pop() returns an empty string and bypasses the Roman-numeral guard (Codex #53).
  const last = text.replace(/[\s.:：。()（）]+$/, '').trim().split(/\s+/).pop() ?? ''
  return !ROMAN_ID.test(last)
}

export function classify(el: Element): Classification | null {
  const skip = SKIP_RULES.find(r => el.matches(r.selector))
  if (skip) return { kind: 'skip', rule: skip.id, descend: false }
  if (el.matches(TABLE_RULES.root)) return TABLE_CLASSIFICATION
  const unit = UNIT_RULES.find(r => el.matches(r.selector))
  if (unit) return { kind: 'unit', rule: unit.id, descend: true }
  const protect = PROTECT_RULES.find(r => el.matches(r.selector))
  // Named tags are not void: words such as Definition / Table / Algorithm need translation.
  if (protect?.id === 'tag' && isNamedTag(el)) return null
  if (protect) return { kind: 'protect', rule: protect.id, descend: protect.descend ?? false }
  return null
}

/**
 * Functional inline elements lose behavior if only their text survives. Preserve entire nodes in runs fallback (§6.5, issue #44).
 * Almost all arXiv body links are .ltx_ref or mailto and already protected; this guards ordinary <a> and other sites in v2.
 */
export const FUNCTIONAL_INLINE = 'a[href]'

/** Figures and graphics, used by Phase 0 statistics. */
export const FIGURE_SELECTORS = { figure: '.ltx_figure', graphics: 'img.ltx_graphics' } as const

/** Footnotes for §7.2 alignment: container, body, body class, own marker. */
export const NOTE = {
  root: '.ltx_note',
  content: '.ltx_note_content',
  contentClass: 'ltx_note_content',
  marks: '.ltx_note_mark, .ltx_tag',
} as const

/** Whole-figure splitting (§7.2): untranslatable media needs a copy in each column. */
export const FIGURE_MEDIA = 'img, svg, object, math, canvas, video, .ltx_picture'

/**
 * ar5iv places publication metadata (DOI / journal / CCS) and footnotes outside the article using
 * float: inline-end with negative margins. They have no translations; mirroring duplicates them in the other column,
 * while the original's float overlaps its neighbor (2312.17141: 1320→1752, over the right column).
 * Without mirrors, they naturally span both columns and float back to the page edge (2084→2516, matching the original layout).
 */
export const MARGIN_ASIDE = '.ltx_pubnotes, .ltx_note'

/** Main document title: centered via text-align:center; never pair inline with its translation (§7.3). */
/**
 * LaTeXML selectors for side-layout classification (DESIGN §7.2). Rule tables identify what to translate;
 * these describe its structure. Both are LaTeXML knowledge, centralized here per CLAUDE.md hard rule 2.
 * renderer/side-layout.ts only composes these selectors, without ltx_ literals (Codex #22).
 * styles/modes.css has the same list (the sole permitted exception); tests enforce consistency.
 */
export const SIDE_LAYOUT = {
  /** Multi-panel flex figures: any direct cell not full-width (ltx_flex_size_1). */
  multiPanelFlex: '.ltx_flex_figure:has(> .ltx_flex_cell:not(.ltx_flex_size_1))',
  /**
   * Inline / preformatted contexts would break if changed to grids.
   * Exclude resizebox wrappers from this category (.ltx_transformed_outer, measured 2026-09-07 in 2606.07636v2). Despite
   * .ltx_inline-block, they are single-content block shells. ar5iv overrides width / height / inner transform with !important:
   * .ltx_table > .ltx_transformed_outer >
   * .ltx_transformed_inner { width: initial !important; transform: none !important }, so scaling is already disabled.
   * Treating them as inline exclusions leaves inner table pairs unable to reach grid tracks. Both become inline-table,
   * centered in one full-width shell across the divider (all five measured tables overflowed; wide tables wrapped full-width).
   */
  atomicContext: '.ltx_inline-block:not(.ltx_transformed_outer), .ltx_note, .ltx_listing',
  /** Pair members themselves; internal translations are nested units such as footnotes, not their own counterparts. */
  pairMember: '.ltx_p, .ltx_title, .ltx_caption, .ltx_bibblock',
  /** Footnote collapse uses .ltx_note_outer display; exclude the entire subtree. */
  note: '.ltx_note',
  /** Stacked regions have no right column. Exclude resizebox wrappers as explained in atomicContext. */
  stack: '.ltx_td, .ltx_inline-block:not(.ltx_transformed_outer)',
} as const

export const DOCUMENT_TITLE = '.ltx_title_document'
/** Document subtitle (\subtitle), centered with the main title; not an inline candidate either. */
export const DOCUMENT_SUBTITLE = '.ltx_subtitle'

/** Abstract and its own heading; remove the heading when extracting paper context. */
export const ABSTRACT = { root: '.ltx_abstract', title: '.ltx_title' } as const

/** Inline-title candidates: title units except main document title; rendering checks length separately. */
/**
 * Inline title eligibility (§7.3): exclude document title and subtitle (Codex #13).
 * Both are centered; inline-block shrinks them to content width and left-aligns them.
 * Measured 2026-09-06 on 2609.00246's (Extended Version): originally display:block,
 * text-align:center, full 800 px column, text centered at x≈720; inline-block shrank the box to 176 px
 * at l=320 because article uses text-align:start. LaTeXML .ltx_subtitle comes from \subtitle,
 * only in title areas (both examples in 12 fixtures follow .ltx_title_document). Section run-in .ltx_title_* is unaffected.
 */
export function isInlineTitleCandidate(el: Element): boolean {
  return classify(el)?.rule === 'title' && !el.matches(`${DOCUMENT_TITLE}, ${DOCUMENT_SUBTITLE}`)
}

export function documentRoot(doc: Document | Element): Element | null {
  // Accept the translation root itself; querySelector only searches descendants and would miss it (Codex #2 / #3).
  if ('matches' in doc && doc.matches(DOCUMENT_ROOT)) return doc
  return doc.querySelector(DOCUMENT_ROOT)
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/**
 * Text excluding protect / skip subtrees, without trimming (§6.2 preserves thin spaces around formulas).
 * Ignore descend: footnote bodies are not visible text of outer paragraphs; descend controls block discovery only.
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

/** Translatable = visible text contains a Unicode letter; formula / number / punctuation-only blocks do not qualify. */
export function hasTranslatableText(el: Element): boolean {
  return LETTER.test(visibleText(el))
}

// Numeric cells (§5.3): require a digit (avoid interpreting E-prefixed words such as ERROR as exponents); also accept symbols, N/A, whitespace.
const NUMERIC_CELL = /^(?=.*\d)[\s\d.,+\-±×^%()/*eE−–—:;~<>=≤≥∼]+(\s*[a-zA-Zμ°%]{1,4})?$/
const SYMBOL_CELL = /^[✓✗✔✘–—−\-·×*]+$/
const NA_CELL = /^N\/A$/

/** Input is visibleText output (formulas excluded); matches are copied unchanged without translation. */
export function isNumericCell(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  return t === '' || NUMERIC_CELL.test(t) || SYMBOL_CELL.test(t) || NA_CELL.test(t)
}
