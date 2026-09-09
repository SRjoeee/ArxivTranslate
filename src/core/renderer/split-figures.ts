// Split whole figures for side mode (DESIGN §7.2): source captions on the left, translated captions on the right.
//
// Images and formulas lack translations, so block pairing leaves the right empty; spanning both columns loses comparison.
// Clone the whole figure: remove each original pair member from the clone, retaining translations; hide translations inside the original in side mode.
// Matching structure aligns rows naturally. Table floats do not use this path; their tables already have translated clones.
//
// Do not scale (user decision, 2026-09-05). Let ar5iv reflow narrower columns: .ltx_flex_figure already uses
// flex-flow: wrap, stacking panels naturally (2312.17141: 342 px tall full-width, 546 px half-width, no overflow).
// Content that cannot reflow (wide formulas / SVG; 3 of 8 figures overflowed by 78 / 102 / 209 px) scrolls horizontally within its column.
// Never change font size. Feeding column width into ar5iv's --main-width (used for .33/.5 panel widths)
// made it worse: 160 px panels still overflowed by 555 px. Leave that variable untouched.
import { DOCUMENT_ROOT, FIGURE_MEDIA } from '@/core/rules/latexml'
import { ID_ATTR } from '@/core/extractor'
import { IMG_CLASS } from '@/core/marks'
import { hashText } from '@/shared/hash'
import { MIRROR_CLASS } from './mirror'
import { PENDING_CLASS } from './pending'
import { FOR_ATTR, T_CLASS } from './index'

/** Real translations, excluding pending spinners and failure widgets (§7.6). */

/** Original marker; only data-axt-* may be added to original nodes (§7.1). */
export const SPLIT_ATTR = 'data-axt-split'
/** Clone class; also carries T_CLASS so pairing rules place it in the right column. */
export const SPLIT_CLASS = 'axt-split'

/**
 * Real translations use the same boundary as §7.5 presets: spinners, errors, mirrors, and split clones carry .axt-t only for pairing.
 * Missing the .axt-mirror exclusion (issue #46, 2312.17141) let pending-caption figures mirror their media; a later full pass treated mirrors as translations,
 * removed them, and cloned a figure with no translated text. In the full-pass baseline, 2 of 7 split figures were these false splits.
 */
const REAL_TRANSLATION = `.${T_CLASS}:not(.${PENDING_CLASS}, .axt-error, .${MIRROR_CLASS}, .${SPLIT_CLASS})`
/** Overlays (§15.2) count as translations: split figures containing only overlays; update signatures and rebuild clones when overlays arrive. */
const REAL_OR_IMAGE = `${REAL_TRANSLATION}, .${IMG_CLASS}`
/** Translation-content signature captured at cloning, used to detect additions / changes requiring a rebuild. */
const KEY_ATTR = 'data-axt-split-key'

/** Rebuild when text changes even at the same count (e.g. new target); counting alone would retain stale clones (Codex #26). */
function translationKey(fig: Element): string {
  const texts = Array.from(fig.querySelectorAll(REAL_OR_IMAGE), t => t.textContent ?? '')
  return `${texts.length}:${hashText(JSON.stringify(texts))}`
}

/**
 * Whether media is unowned: outside all translation blocks and translated nodes.
 * Inline caption formulas are also math; checking only for media would misclassify table floats as figures
 * (both table floats in 2312.17527 were split; Codex #26).
 */
function hasLooseMedia(fig: Element): boolean {
  return Array.from(fig.querySelectorAll(FIGURE_MEDIA)).some(m => m.closest(`[${ID_ATTR}], .${T_CLASS}`) === null)
}

/** Outermost enclosing figure, or null; nested panels are cloned together with the outer figure. */
export function outermostFigure(el: Element): Element | null {
  let fig = el.closest('figure')
  while (fig?.parentElement) {
    const outer = fig.parentElement.closest('figure')
    if (!outer) break
    fig = outer
  }
  return fig
}

function needsSplit(fig: Element): boolean {
  if (fig.classList.contains(T_CLASS)) return false // The clone itself.
  if (fig.parentElement?.closest('figure')) return false // Nested panels are handled by the outer figure.
  if (!fig.querySelector(REAL_OR_IMAGE)) return false // No real translations (pending does not count); leave unpaired figures to mirroring.
  return hasLooseMedia(fig) // Floats without unowned media, e.g. tables, already have translated clones and need no whole-figure copy.
}

/** Original ID retained on the clone for local anchors to find the corresponding position (issue #44). */
export const SPLIT_OF_ATTR = 'data-axt-split-of'

/**
 * Clones must not retain original IDs or block markers, but must preserve their correspondence.
 * Only mode hides the original; anchors to internal rows (21 in 2312.17141,
 * including #S3.Ex73–#S3.Ex79 in Figure 6) must navigate to the clone.
 * Without correspondence they can reach only the figure top, possibly leaving the intended row offscreen (Codex #80).
 * Move IDs into data-axt-split-of: no duplicate IDs; removed together with the clone.
 */
function stripIds(root: Element): void {
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const id = el.getAttribute('id')
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) if (name.startsWith('data-axt-')) el.removeAttribute(name)
    if (id) el.setAttribute(SPLIT_OF_ATTR, id)
  }
}

/**
 * Generate translation-only copies of paired figures, idempotently; rebuild when translations are added or changed.
 * Return the number of copies created.
 */
export function splitFigures(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  let made = 0
  for (const fig of Array.from(scope.querySelectorAll('figure'))) {
    if (!needsSplit(fig)) continue
    const key = translationKey(fig)
    const sibling = fig.nextElementSibling
    const existing = sibling?.classList.contains(SPLIT_CLASS) ? sibling : null
    if (existing && existing.getAttribute(KEY_ATTR) === key) continue
    existing?.remove()

    // Mirroring and whole-figure cloning are alternatives; existing injected mirrors would duplicate content, so remove them.
    // Captionless figures may have a whole-figure sibling mirror from startup; remove it when an overlay triggers splitting, or the right column gets three copies.
    for (const stale of Array.from(fig.querySelectorAll(`.${MIRROR_CLASS}`))) stale.remove()
    const figureMirror = fig.nextElementSibling
    if (figureMirror?.classList.contains(MIRROR_CLASS)) figureMirror.remove()

    const clone = fig.cloneNode(true) as Element
    // Pending / failed pairs: remove spinners and widgets from the clone, retain source text; arrival changes the key and rebuilds.
    for (const pending of Array.from(clone.querySelectorAll(`.${PENDING_CLASS}, .axt-error`))) pending.remove()
    // Retain only translations in the clone: remove each original pair member, leaving translated members intact.
    for (const original of Array.from(clone.querySelectorAll('*'))) {
      if (original.classList.contains(T_CLASS)) continue
      if (original.nextElementSibling?.classList.contains(T_CLASS)) original.remove()
    }
    stripIds(clone)
    clone.classList.add(T_CLASS, SPLIT_CLASS)
    clone.setAttribute(FOR_ATTR, `split:${made}`)
    clone.setAttribute(KEY_ATTR, key)

    fig.setAttribute(SPLIT_ATTR, '')
    fig.after(clone)
    made++
  }
  return made
}

/**
 * Discard stale clones outside side mode (§15.2): OCR arriving after side → only inserts an overlay into the hidden original,
 * leaving its clone stale. Rebuilding only in side mode would hide the overlay until returning there. Remove the clone and original marker,
 * showing the original (already visible in stack; its translations remain visible in only). A full side-mode cleanup later rebuilds it.
 * Return the number of discarded copies.
 */
export function dropStaleSplits(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  let dropped = 0
  for (const fig of Array.from(scope.querySelectorAll(`[${SPLIT_ATTR}]`))) {
    const sibling = fig.nextElementSibling
    const existing = sibling?.classList.contains(SPLIT_CLASS) ? sibling : null
    if (existing && existing.getAttribute(KEY_ATTR) === translationKey(fig)) continue
    existing?.remove()
    fig.removeAttribute(SPLIT_ATTR)
    dropped++
  }
  return dropped
}
