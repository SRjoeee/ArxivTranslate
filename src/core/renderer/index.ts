// Rendering (DESIGN §7). Original code: all three references modify / wrap / replace originals, violating §7.1 DOM invariants.
// Invariants: translations are next siblings of originals; originals receive only data-axt-id / data-axt-state attributes;
// global state lives on <html>; restore returns the DOM node-for-node to its pretranslation state.
import type { Block, TableBlock, TextBlock } from '@/core/extractor'
import { AXT_ATTR_PREFIX, INJECTED_SELECTOR, T_CLASS, isInjected, stripInjected } from '@/core/marks'
import { isInlineTitleCandidate, tableCells, visibleText } from '@/core/rules/latexml'
import imageCss from '@/styles/image.css?inline'
import modesCss from '@/styles/modes.css?inline'
import presetsCss from '@/styles/presets.css?inline'
import { STYLE_ATTR_NAME, customStyleRule, type StylePreset } from './style-preset'
import { delocalizeNotes } from './notes'
import { cancelSpinnersIn } from './spinner'

export type Mode = 'stack' | 'side' | 'only'
export type BlockState = 'pending' | 'translated' | 'failed'

export { T_CLASS }
export const FOR_ATTR = 'data-axt-for'
export const STATE_ATTR = 'data-axt-state'
export const ON_ATTR = 'data-axt-on'
export const MODE_ATTR = 'data-axt-mode'
/** Inline short titles (§7.3): set on both original and translated titles. */
export const INLINE_ATTR = 'data-axt-inline'
/** Translation language (BCP-47), written to <html> by enable and read by renderText. */
export const LANG_ATTR = 'data-axt-lang'
/**
 * Mark translations identical to their source (Codex #74). This default-prompt instruction:
 * "Keep author names, journal names, conference names … in the original language"
 * returns citation author lists containing only names unchanged; renderText always inserts a sibling,
 * duplicating each author row in stack mode. This applies to any unchanged block, not just names.
 * Let CSS handle the marker: hide duplicates in stack; retain them for side-column alignment and only mode, where originals are hidden.
 */
export const IDENTITY_ATTR = 'data-axt-identity'
/**
 * Partially translated table (§5.3): keep the original translated so only mode shows its clone; add a marker for the failure border and count.
 * Marking failed instead would expose both the original and partial clone in only mode (Codex #30).
 */
export const PARTIAL_ATTR = 'data-axt-partial'
/** Maximum visible source-title length for inline pairing. */
export const INLINE_TITLE_MAX_CHARS = 60

/** Injected <style> marker, removed on restore. Previously data-axt, violating hard rule 5's data-axt- prefix (Codex #3). */
/** Marker for injected <style> elements, distinct from the data-axt-style preset on <html>. */
export const STYLE_ATTR = 'data-axt-sheet'
const STYLE_MARK = 'modes'

/**
 * Enable translation state: set <html> attributes and inject mode / preset styles idempotently.
 * Like mode, preset is just an <html> attribute (§7.5); switching leaves the DOM unchanged. Recompute custom CSS on injection.
 */
export function enable(doc: Document, mode: Mode, style?: { preset: StylePreset; customCss?: string }, lang?: string): void {
  doc.documentElement.setAttribute(ON_ATTR, '')
  doc.documentElement.setAttribute(MODE_ATTR, mode)
  // Store the target language on <html> (§7.1 global state); renderText applies it to each translation node's lang.
  // Do not change <html lang>: that would also mislabel the original as Chinese.
  if (lang) doc.documentElement.setAttribute(LANG_ATTR, lang)
  if (style) setStylePreset(doc, style)
  const existing = doc.querySelector(`style[${STYLE_ATTR}="${STYLE_MARK}"]`)
  const css = `${modesCss}\n${presetsCss}\n${imageCss}\n${style ? customStyleRule(style.customCss ?? '') : ''}`
  if (existing) {
    // Custom CSS may change between runs through options. Write only changed content to avoid needless style recalculation.
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const el = doc.createElement('style')
  el.setAttribute(STYLE_ATTR, STYLE_MARK)
  el.textContent = css
  doc.head.append(el)
}

/** Switch presets by attribute only (§7.5); enable injects custom declarations. */
export function setStylePreset(doc: Document, style: { preset: StylePreset }): void {
  doc.documentElement.setAttribute(STYLE_ATTR_NAME, style.preset)
}

/** Mode switches change one attribute without running translation (§4 step 9). */
export function setMode(doc: Document, mode: Mode): void {
  doc.documentElement.setAttribute(MODE_ATTR, mode)
}

export function setState(block: Block, state: BlockState): void {
  block.el.setAttribute(STATE_ATTR, state)
  // A state change invalidates the previous partial marker; mark partial success after setState.
  block.el.removeAttribute(PARTIAL_ATTR)
}

export function markPartial(block: Block): void {
  block.el.setAttribute(PARTIAL_ATTR, '')
}

/**
 * Remove previous translations, retaining only the latest on retry / engine change.
 * Also remove on failed retranslation: old text must not masquerade as results for a new engine / target (Codex #9).
 */
export function clearTranslation(block: Block): void {
  // Footnote markers and copies belong to the translation; show original margin notes again when it disappears.
  delocalizeNotes(block.el)
  // Remove inline markers too, or untranslated short titles stay inline-block (Codex #30). Successful renderText restores them.
  block.el.removeAttribute(INLINE_ATTR)
  const parent = block.el.parentElement
  if (!parent) return
  for (const sibling of Array.from(parent.children)) {
    if (sibling.classList.contains(T_CLASS) && sibling.getAttribute(FOR_ATTR) === block.id) {
      // Pending nodes contain spinners; cancel animation before removal (§7.6).
      cancelSpinnersIn(sibling)
      sibling.remove()
    }
  }
}

/** Translation classes: original classes plus axt-t, retaining site styling (§7.1). */
export function translationClass(el: Element): string {
  const own = Array.from(el.classList).filter(c => c !== T_CLASS)
  return [...own, T_CLASS].join(' ')
}

/** Inline short-title pairing (§7.3), also for pending nodes to avoid layout shifts when translations arrive. */
export function shouldInline(block: TextBlock): boolean {
  return isInlineTitleCandidate(block.el) && visibleText(block.el).trim().length <= INLINE_TITLE_MAX_CHARS
}

/** Text block: same tag as the original, filled with the rehydrated fragment (clone IDs stripped). */
export function renderText(block: TextBlock, content: DocumentFragment): Element {
  clearTranslation(block)
  const node = block.el.ownerDocument.createElement(block.el.tagName)
  node.append(content)
  // A table cell's .ltx_p can itself be a block, whose translation sibling sits inside the original table and gets cloned too (observed 2026-09-04).
  stripInjected(node, false)
  node.className = translationClass(block.el)
  node.setAttribute(FOR_ATTR, block.id)
  // The page's <html lang> describes the source (en on arXiv). Without a target lang, screen readers pronounce Chinese
  // using an English voice (all 14 measured translation nodes inherited lang="en"; Codex's peer review missed this).
  const lang = block.el.ownerDocument.documentElement.getAttribute(LANG_ATTR)
  if (lang) node.setAttribute('lang', lang)
  if (shouldInline(block)) {
    block.el.setAttribute(INLINE_ATTR, '')
    node.setAttribute(INLINE_ATTR, '')
  }
  // Identical normalized text means the block was returned unchanged. Ignore whitespace differences introduced
  // at tag boundaries during rehydration.
  // Exclude injected nodes on both sides (Codex #81): blocks can nest. If the inner block finishes first,
  // original textContent includes its translation, while stripCloned already removed it from the candidate.
  // Including it would make unchanged outer blocks appear different and still duplicate them in stack mode.
  if (squash(ownText(node)) === squash(ownText(block.el))) node.setAttribute(IDENTITY_ATTR, '')
  block.el.after(node)
  setState(block, 'translated')
  return node
}

const squash = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()

/** Element text excluding injected translations / mirrors / split copies / spinners / failure widgets. */
function ownText(el: Element): string {
  let text = ''
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      const element = child as Element
      if (isInjected(element)) continue
      text += ownText(element)
    } else text += child.textContent ?? ''
  }
  return text
}

/**
 * Table block (§5.3): clone the whole table after its original, retaining classes for site styling.
 * Replace translated cells; leave numeric / formula cells cloned. cells is keyed by original cell elements.
 */
export function renderTable(block: TableBlock, cells: Map<Element, DocumentFragment>): Element {
  clearTranslation(block)
  const clone = block.el.cloneNode(true) as Element
  stripInjected(clone)
  // Trees share structure: tableCells returns original / cloned cells in corresponding order, including nested tables.
  // Locate each cell again before replacement: an outer translation includes a new nested-table clone.
  // References collected before replacing the outer cell would point to discarded inner nodes (§5.3).
  block.cells.forEach((cell, i) => {
    const content = cells.get(cell.el)
    if (!content) return
    const target = tableCells(clone)[i]
    if (!target) return
    target.textContent = ''
    target.append(content)
  })
  clone.classList.add(T_CLASS)
  clone.setAttribute(FOR_ATTR, block.id)
  block.el.after(clone)
  setState(block, 'translated')
  return clone
}

/** Restore: remove all injected nodes (translations and overlays, §7.1 rule 4), all data-axt-* attributes, and injected styles including #axt-debug. */
export function restore(doc: Document): { removedNodes: number; strippedAttrs: number } {
  let removedNodes = 0
  let strippedAttrs = 0
  for (const node of Array.from(doc.querySelectorAll(INJECTED_SELECTOR))) {
    cancelSpinnersIn(node)
    node.remove()
    removedNodes++
  }
  // Remove styles before stripping attributes, since their own markers are data-axt-* too.
  for (const style of Array.from(doc.querySelectorAll(`style[${STYLE_ATTR}]`))) style.remove()
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith(AXT_ATTR_PREFIX)) {
        el.removeAttribute(attr.name)
        strippedAttrs++
      }
    }
  }
  return { removedNodes, strippedAttrs }
}

export * from './mirror'
export * from './side-layout'
export * from './table-fit'
export * from './pair-margins'
export * from './notes'
export * from './anchors'
export * from './prep'
export * from './split-figures'
export * from './responsive'
export * from './spinner'
export * from './pending'
export * from './failed'
export * from './style-preset'
export * from './image'
