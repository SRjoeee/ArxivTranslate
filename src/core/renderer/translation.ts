// A block's translation node (DESIGN §7; ADR-0003). Original work: all three reference projects change, wrap or
// replace the original node, against the DOM invariant of §7.1.
// The invariant: a translation node is inserted only as the original block's next sibling; the original node only
// gains data-axt-* attributes; after restore the DOM equals the pre-translation DOM node by node.
import type { Block, TableBlock, TextBlock } from '@/core/extractor'
import { T_CLASS, isInjected, stripInjected } from '@/core/marks'
import { tableCells } from '@/core/rules/latexml'
import { type BlockState, DIR_ATTR, FOR_ATTR, IDENTITY_ATTR, INLINE_ATTR, LANG_ATTR, PARTIAL_ATTR, STATE_ATTR } from './attrs'
import { delocalizeNotes } from './notes'
import { shouldInline, translationClass, translationShell } from './shell'
import { cancelSkeletonsIn } from './skeleton'
import { collectText, squash } from '@/core/text'

export function setState(block: Block, state: BlockState): void {
  block.el.setAttribute(STATE_ATTR, state)
  // A state change expires the previous round's “half translated” mark; a partial success is marked after setState
  block.el.removeAttribute(PARTIAL_ATTR)
}

export function markPartial(block: Block): void {
  block.el.setAttribute(PARTIAL_ATTR, '')
}

/**
 * Remove the block's existing translation: a block rendered again (a retry, another engine) keeps the newest only;
 * a failed retranslation removes it too — after an engine / target-language change the page must not keep the
 * previous round's translation passing for this one (Codex on #9)
 */
export function clearTranslation(block: Block): void {
  // The footnote placement's mark and copy go with the translation: with it gone, the original margin note must show again
  delocalizeNotes(block.el)
  // The same-line mark goes with the translation too: left there, a short heading without a translation would still be squeezed into an inline-block (Codex on #30); renderText adds it back on success
  block.el.removeAttribute(INLINE_ATTR)
  const parent = block.el.parentElement
  if (!parent) return
  for (const sibling of Array.from(parent.children)) {
    if (sibling.classList.contains(T_CLASS) && sibling.getAttribute(FOR_ATTR) === block.id) {
      // A pending node holds a ring: the animation is cancelled before removal (§7.6)
      cancelSkeletonsIn(sibling)
      sibling.remove()
    }
  }
}

/**
 * Is the fragment filled back a cell itself.
 *
 * On the placeholder path a description row's whole cell is one paired placeholder, and the top-level element
 * `rehydrate` hands back **is already a `<td>`**; one more shell makes `<tr><td><td>…</td></td></tr>` (Codex on
 * #168; my first test used a bare text fragment and missed it). The runs fallback path flattens the markup, hands
 * back plain text, and still needs the shell
 */
function isCellFragment(content: DocumentFragment): boolean {
  let cell: Element | null = null
  for (const node of Array.from(content.childNodes)) {
    if (node.nodeType === 1) {
      if (cell) return false
      const el = node as Element
      if (!el.matches('td, th')) return false
      cell = el
    } else if (/\S/.test(node.textContent ?? '')) {
      return false
    }
  }
  return cell !== null
}

/** A text block: a new element of the original's tag name, its content the fragment the protector filled back (the clone with ids stripped) */
export function renderText(block: TextBlock, content: DocumentFragment): Element {
  clearTranslation(block)
  const { node, slot } = translationShell(block)
  // What was filled back is already a `<td>`: used as it is, no further shell (see isCellFragment)
  if (slot !== node && isCellFragment(content)) {
    slot.remove()
    node.append(content)
  } else {
    slot.append(content)
  }
  // A .ltx_p inside a table cell is a block itself, and its translation is inserted as a sibling inside the original table; a whole-table clone copies it along (measured 2026-09-04)
  stripInjected(node, false)
  node.className = translationClass(block.el)
  node.setAttribute(FOR_ATTR, block.id)
  // The translation is in another language, and the page's <html lang> names the original's (en on arXiv). Unmarked,
  // a screen reader reads Chinese in an English voice (measured: all 14 translation nodes inherited lang="en"; Codex's
  // peer audit did not catch it)
  const html = block.el.ownerDocument.documentElement
  const lang = html.getAttribute(LANG_ATTR)
  if (lang) node.setAttribute('lang', lang)
  // A right-to-left language needs `dir` as well: `lang` only says which language, and a paragraph's base direction
  // is set by `dir`. Written on real translations only — skeletons and failure widgets are in the interface
  // language, and a mirror holds the original
  const dir = html.getAttribute(DIR_ATTR)
  if (dir) node.setAttribute('dir', dir)
  if (shouldInline(block)) {
    block.el.setAttribute(INLINE_ATTR, '')
    node.setAttribute(INLINE_ATTR, '')
  }
  // Identical after normalisation = this block was not really translated. Whitespace differences do not count: the
  // whitespace at tag boundaries after rehydrate need not match the original one to one.
  // Both sides **skip injected nodes** (Codex on #81): blocks nest, and with an inner block translated first the
  // original's textContent holds an extra stretch of inner translation, which stripCloned removed from the candidate
  // long ago — not excluded, an outer block returned unchanged could never be judged identical, and stack mode would
  // keep the duplicate
  if (squash(ownText(node)) === squash(ownText(block.el))) node.setAttribute(IDENTITY_ATTR, '')
  block.el.after(node)
  setState(block, 'translated')
  return node
}

/** The element's own text, without the nodes we inject (translation, mirror, split copy, skeleton, failure widget) */
const ownText = (el: Element): string => collectText(el, isInjected)

/**
 * A table block (§5.3): the whole table cloned after the original, the clone keeping its class names so the page's
 * table styles apply; cells with a translation get their content replaced, numeric and formula cells keep the
 * clone's. The keys of cells are the original table's cell elements.
 *
 * @param rendered filled in with original cell → the clone's cell that now holds its translation,
 *   so the caller can pair the two sides for the hover highlight (§7.7). Only the clone's cells are
 *   on screen, and they are built here, so nowhere else can make that pairing.
 */
export function renderTable(block: TableBlock, cells: Map<Element, DocumentFragment>, rendered?: Map<Element, Element>): Element {
  clearTranslation(block)
  const clone = block.el.cloneNode(true) as Element
  stripInjected(clone)
  // A translated cell needs `lang` / `dir` too, for the same two reasons as in renderText (Codex on #163 noted the
  // table path had missed `dir`; `lang` was missed as well, and a screen reader would read the table's Chinese in
  // an English voice). Set on the **cells whose content was replaced**, not on the whole table: `dir` on `<table>`
  // flips the column order too, and the untranslated numeric columns of this clone are as they were — a flipped
  // order would no longer match the original table above; on a cell it changes only that cell's base direction,
  // exactly the one thing wanted
  const html = block.el.ownerDocument.documentElement
  const cellLang = html.getAttribute(LANG_ATTR)
  const cellDir = html.getAttribute(DIR_ATTR)
  // The two trees share one structure: the original's cells and the clone's correspond in order (tableCells takes
  // any depth, cells of a nested tabular included). Each cell is located afresh before replacing: an outer cell's
  // translation carries the nested table's clone, so the outer is replaced before the inner, and an inner reference
  // taken in advance would point at a node already discarded (§5.3)
  block.cells.forEach((cell, i) => {
    const content = cells.get(cell.el)
    if (!content) return
    const target = tableCells(clone)[i]
    if (!target) return
    target.textContent = ''
    target.append(content)
    if (cellLang) target.setAttribute('lang', cellLang)
    if (cellDir) target.setAttribute('dir', cellDir)
    rendered?.set(cell.el, target)
  })
  clone.classList.add(T_CLASS)
  clone.setAttribute(FOR_ATTR, block.id)
  block.el.after(clone)
  setState(block, 'translated')
  return clone
}
