// The runs path (DESIGN §6.5): the text is cut into runs at void nodes, paired text merges into its run (styling
// lost), each run is translated and the runs are joined back in their original order.
//
// **An element with behaviour cannot be reduced to its text** (issue #44): lost styling still reads, a lost link no
// longer clicks. Such elements are treated as voids on this path — kept whole, their text untranslated. The fallback
// is lossy by nature, and keeping behaviour matters more than translating a few more words. Measured over the 4221
// translation blocks of the 12 fixtures: 0 such links (the links in arXiv body text are .ltx_ref or mailto, protected
// by the rules layer already), so this is a structural guarantee and a fallback for other sites in v2.
import { FUNCTIONAL_INLINE } from '@/core/rules/latexml'
import { cloneWithoutIds } from './clone'
import type { ProtectedBlock } from './serialize'
import { decodeText } from './text'
import { tokenize } from './tokens'

export type RunItem =
  | { kind: 'text'; run: number }
  | { kind: 'void'; id: number }
  /** A whitespace-only run: not sent for translation, kept as it is */
  | { kind: 'raw'; text: string }

export interface RunLayout {
  items: RunItem[]
  /**
   * The runs sent for translation, in the order they appear in items, **in their wire form (`& < >` still entities)**.
   *
   * Unescaping used to happen here, so `a &lt; b` went out as `a < b` — while `google-web`'s endpoint is
   * `translateHtml`, which parses the request body as HTML; the `&amp;` that came back was then put into the text node
   * as it was by `joinRuns`, and the reader saw the entity itself (issue #111). Sending and receiving must be
   * symmetric: escaped here, decoded on the `joinRuns` side.
   */
  runs: string[]
}

export function splitRuns(block: ProtectedBlock): RunLayout {
  const items: RunItem[] = []
  const runs: string[] = []
  let buffer = ''
  const flush = () => {
    if (!buffer) return
    if (/\S/.test(buffer)) {
      items.push({ kind: 'text', run: runs.length })
      runs.push(buffer)
    } else {
      // A raw run is not sent and goes straight into a text node, so it is decoded here
      items.push({ kind: 'raw', text: decodeText(buffer) })
    }
    buffer = ''
  }
  const isFunctional = (id: number) => {
    const node = block.slots.get(id)
    return node?.nodeType === 1 && (node as Element).matches(FUNCTIONAL_INLINE)
  }
  // Skipping a paired element's whole subtree has to count the nesting depth, or an inner </t> ends it early
  let skipDepth = 0
  for (const t of tokenize(block.text, block.format)) {
    if (skipDepth > 0) {
      if (t.kind === 'open') skipDepth++
      else if (t.kind === 'close') skipDepth--
      continue
    }
    if (t.kind === 'text') buffer += t.text
    else if (t.kind === 'void') {
      flush()
      items.push({ kind: 'void', id: t.id })
    } else if (t.kind === 'open' && isFunctional(t.id)) {
      // An element with behaviour is kept whole: treated like a void, its content skipped along
      flush()
      items.push({ kind: 'void', id: t.id })
      skipDepth = 1
    }
    // Any other open / close: the paired tag is dropped, its text merged into the buffer already
  }
  flush()
  return { items, runs }
}

export function joinRuns(translatedRuns: string[], layout: RunLayout, block: ProtectedBlock, doc: Document): DocumentFragment {
  if (translatedRuns.length !== layout.runs.length) {
    throw new Error(`runs count mismatch: expected ${layout.runs.length}, got ${translatedRuns.length}`)
  }
  const fragment = doc.createDocumentFragment()
  for (const item of layout.items) {
    // The translation comes from the wire; the entities are decoded at this step (see the note on RunLayout.runs)
    if (item.kind === 'text') fragment.append(doc.createTextNode(decodeText(translatedRuns[item.run]!)))
    else if (item.kind === 'raw') fragment.append(doc.createTextNode(item.text))
    else fragment.append(cloneWithoutIds(doc, block.slots.get(item.id)!, true))
  }
  return fragment
}
