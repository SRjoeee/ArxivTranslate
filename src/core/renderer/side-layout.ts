import { SIDE_LAYOUT } from '@/core/rules/latexml'
// Side-mode structural classification (DESIGN §7.2). Single source of truth; tests guard matching lists in modes.css.
// All ltx_* literals come from rules/SIDE_LAYOUT (CLAUDE.md hard rule 2); this module only composes them.
//
// Pairing containers are elements containing translations, except the small exclusion set below.
// Flex containers can be excluded: descendants need grid-item ancestry to subgrid outer tracks, and flex breaks that chain.
// Pairs inside excluded cells still need stacking fallback (modes.css), or they create implicit columns of their own.
//
// Only nongrid elements may be excluded. Excluding an existing grid does not prevent descendants from subgridding it;
// they inherit the site's tracks. In 2609.00097, paragraphs inside ordered lists used ar5iv's 12 px numbering track,
// pushing English across the divider and squeezing Chinese into 39 px. Existing ar5iv grids (.ltx_enumerate / .ltx_biblist)
// must be taken over, not excluded.
/**
 * Multi-panel flex figure: .ltx_flex_figure with at least one cell not full-width (ltx_flex_size_1).
 * Exclude only these, including their entire subtrees. ar5iv flex places panels side by side; pairs stack without mirrors.
 * Single-column figures whose cells are all size_1 (often tables with footnotes, e.g. 2609.03768v1 Table 1) have full-width cells.
 * Treat these as ordinary containers for side-by-side table / footnote pairing; class-wide exclusion previously stacked them incorrectly.
 * happy-dom mishandles :not(:is(complex selectors with :has)), so use closest(), as for other subtree exclusions.
 */
export const MULTI_PANEL_FLEX = SIDE_LAYOUT.multiPanelFlex

export const SIDE_DENY = [
  '.axt-t',                                            // Translations are not containers.
  'table', 'thead', 'tbody', 'tr', 'td', 'th',         // Turning table internals into grids breaks tables.
  SIDE_LAYOUT.atomicContext,                           // Inline and preformatted contexts.
  SIDE_LAYOUT.pairMember,                              // Pair members; internal translations are nested units such as footnotes.
].join(', ')

/**
 * Exclude these entire subtrees. ar5iv stores collapsed footnote state as display: none on .ltx_note_outer.
 * A nested translation would make the container rule match :has(.axt-t) and override it with display: grid,
 * exposing a 165 px tall, 781 px wide collapsed note amid body text, conflicting with center-column translations (2312.17141; user report).
 *
 * CSS adds .ltx_note * to exclusions. Do not include it in SIDE_CONTAINER here: happy-dom's
 * :is(.ltx_note *) always returns false, although standalone .ltx_note * works; inclusion would diverge tests from browsers.
 * Use isSideContainer() at runtime instead.
 */
export const SIDE_DENY_SUBTREE = [
  SIDE_LAYOUT.note, // Footnotes, described above.
  // Whole split figures: neither copy participates in the pairing grid; ar5iv lays out their internals (§7.2).
  '[data-axt-split]', '.axt-split',
  MULTI_PANEL_FLEX, // Multi-panel figures, described above.
].join(', ')

/**
 * Elements CSS turns into two-column grids: contain translations or block markers, minus exclusions.
 * Mark blocks at session start (§10), making the whole page two columns at once without later horizontal shifts.
 * Translation-only matching left distant lazy blocks full-width until entering the prefetch margin (user report, revised 2026-09-05).
 */
export const SIDE_CONTAINER = `:has(.axt-t, [data-axt-id]):not(:is(${SIDE_DENY}))`

/** Pairing-container check including subtree exclusions. Always use this at runtime, not matches(SIDE_CONTAINER). */
export function isSideContainer(el: Element): boolean {
  return el.matches(SIDE_CONTAINER) && el.closest(SIDE_DENY_SUBTREE) === null
}

/**
 * Mirroring containers also include marked blocks whose translations have not arrived.
 * Formulas and images have no translations; waiting for their containing paragraphs only delays their mirrors.
 * In 2312.17141, all 413 mirrors appeared at completion, leaving formulas centered across both columns until then.
 * Block markers exist immediately at startup, allowing the first side-prep pass to mirror everything.
 * Safety is unchanged: never mirror children marked as blocks or containing blocks (mirror.ts guard 2), preventing wholesale duplication.
 */
export const MIRROR_CONTAINER = SIDE_CONTAINER

export function isMirrorContainer(el: Element): boolean {
  return el.matches(MIRROR_CONTAINER) && el.closest(SIDE_DENY_SUBTREE) === null
}

// Stacked regions: pairs stack instead of forming columns (the identical modes.css list is guarded by tests).
// No right column means no mirrors; mirrors exist solely to fill that column.
// Here they would duplicate content vertically (each panel's formulas appeared twice in 2312.17141's three-panel figure).
// Multi-panel flex figures are absent: SIDE_DENY_SUBTREE already excludes their entire subtree, so pairs stack and mirrors cannot enter.
export const SIDE_STACK = [
  SIDE_LAYOUT.stack, // Nested containers inside blocks.
].join(', ')
