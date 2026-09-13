// The renderer's names (ADR-0003): every `data-axt-*` attribute, every injected sub-class that more than one module
// reads, and the one definition of the translation boundary. A leaf on purpose — it imports nothing from the
// renderer, so any module can read a name without joining a cycle. The injected *node* classes
// (`axt-t`, `axt-img`, `axt-hl`, `axt-peek`) stay in `core/marks.ts`, which the extractor and the
// protector need without depending on the renderer.

export type Mode = 'stack' | 'side' | 'only'
export type BlockState = 'pending' | 'translated' | 'failed'

export const FOR_ATTR = 'data-axt-for'
export const STATE_ATTR = 'data-axt-state'
export const ON_ATTR = 'data-axt-on'
export const MODE_ATTR = 'data-axt-mode'
/** A short heading kept on one line (§7.3): the original heading and its translation both carry it */
export const INLINE_ATTR = 'data-axt-inline'
/** The translation's language (BCP-47), written on <html> by enable for renderText to read */
export const LANG_ATTR = 'data-axt-lang'
/**
 * The translation's writing direction, present on `<html>` only for a right-to-left target language (§7.1: global
 * state lives there only). `renderText` copies it onto every translation node's `dir` — **`lang` alone is not
 * enough**: the bidi algorithm reads `dir`, and arXiv's `<html>` is ltr, so an inherited Arabic translation put its
 * full stops before the words and the whole paragraph flush left (measured)
 */
export const DIR_ATTR = 'data-axt-dir'
/**
 * The mark for “translation identical to the original, word for word” (Codex on #74). The default prompt's line
 * “Keep author names, journal names, conference names … in the original language” makes an author paragraph of
 * bare names come back unchanged, and `renderText` inserts the sibling unconditionally — in stack mode every author
 * line showed twice. Not limited to names: any block whose translation equals its original does the same. Marked
 * and left to CSS: stack hides the duplicate, side needs it to hold the right column, only hides the original
 * anyway — all keep it
 */
export const IDENTITY_ATTR = 'data-axt-identity'
/**
 * A table translated in part (§5.3): the original stays translated (only mode shows the clone as usual), with this
 * extra mark for the failure line and the failure count. Marking it failed outright would not do — only mode hides
 * translated only, so the original and the half clone would both show (Codex on #30)
 */
export const PARTIAL_ATTR = 'data-axt-partial'
/** The mark of the injected <style>; restore removes it whole by this. Once `data-axt`, which broke hard rule 5's `data-axt-` prefix (Codex on #3) */
export const STYLE_ATTR = 'data-axt-sheet'
/** The active style profile's underline on <html> (§7.5), absent when it has none */
export const UNDERLINE_ATTR = 'data-axt-underline'
/** Present on <html> when the active profile blurs the translation until it is hovered (§7.5) */
export const BLUR_ATTR = 'data-axt-blur'

/** The pending node (§7.6): the skeleton after the original block, with axt-t and this class */
export const PENDING_CLASS = 'axt-pending'
/** The failure widget (§7.6): the retry button and the reason, with axt-t and this class */
export const ERROR_CLASS = 'axt-error'
/** The right column's mirror in side mode (§7.2): a clone of the original, with axt-t and this class */
export const MIRROR_CLASS = 'axt-mirror'
/** The split copy of a figure in side mode (§7.2): a clone of the whole figure, with axt-t and this class */
export const SPLIT_CLASS = 'axt-split'
/** On the original: this figure has a split copy */
export const SPLIT_ATTR = 'data-axt-split'
/** In the copy, each element remembers the id of its original (the copy's ids are stripped; anchors and overlay clean-up find their way back by this) */
export const SPLIT_OF_ATTR = 'data-axt-split-of'
/** In the copy, an image overlay remembers which image it belongs to (the copy's data-axt-for is stripped) */
export const SPLIT_FOR_ATTR = 'data-axt-split-for'

/**
 * The classes an `.axt-t` node can carry that make it **not** a translation: the skeleton, the
 * failure widget, side mode's mirror and its split-figure copy. Everything that asks "is this a
 * real translation?" — the appearance rules, the split signature, the anchor fallback, the style
 * sheets — derives its answer from this list, so it cannot drift again (issue #46 was one drift).
 * `tests/renderer/translation-boundary.test.ts` holds the CSS to it.
 */
export const TRANSLATION_EXCLUDED_CLASSES: readonly string[] = [PENDING_CLASS, ERROR_CLASS, MIRROR_CLASS, SPLIT_CLASS]

/** `.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)` — a real translation node */
export const REAL_TRANSLATION = `.axt-t:not(${TRANSLATION_EXCLUDED_CLASSES.map(c => `.${c}`).join(', ')})`
