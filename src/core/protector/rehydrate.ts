// Filling back (DESIGN §6.4): translation → DocumentFragment. Placeholders become clones of the original nodes, placed in the translation's order; the original nodes are untouched.
import { cloneWithoutIds } from './clone'
import { type Boundaries, restoreLeadingLabel } from './label'
import { scanTokens, type WireSpan } from './offsets'
import type { ProtectedBlock } from './serialize'
import { PlaceholderIntegrityError, validate } from './validate'

/**
 * Rebuilds the block from the translated wire text, and reports where each run of that text ended
 * up in the DOM it just built.
 *
 * The offsets are needed because the hover highlight paints on both sides. The source side gets its
 * spans from `serialize` (#123); the translation side can only get them here, since these are the
 * nodes that side is made of, and an offset table computed afterwards would have nothing to key on.
 *
 * Built on `scanTokens` rather than `tokenize`: the spans need each token's wire position, which
 * `tokenize` does not report and should not be changed to report — it is the protector's hottest
 * path (#107 fixed a regression there), and its markers branch has already turned `@@` back into a
 * literal `@` by the time a caller sees a token. `tests/protector/scan.test.ts` pins the two token
 * sequences against each other over every fixture in both formats.
 *
 * Measured over 880 blocks, scanning with positions and building the spans costs about 2% more than
 * the plain tokenize loop (99.4 ms vs 97.8 ms, min of four runs) — under 2 µs on a call that spends
 * 0.11 ms deep-cloning slots. Not worth a second code path to avoid: the only caller wants offsets.
 *
 * The spans hang off the fragment rather than changing the return shape, so the callers that only
 * want the nodes are untouched. They reference the nodes, not the fragment, so they stay valid
 * after the fragment has been appended and emptied.
 */
/**
 * `alignment` is the engine's sentence boundaries for this translation, when it reported them and
 * they verified (`providers/alignment.ts`). The label restore needs them as evidence for a label
 * that ends in a period (`label.ts`); the fragment itself does not.
 */
export function rehydrate(translated: string, block: ProtectedBlock, doc: Document, alignment?: Boundaries): DocumentFragment & { offsets: WireSpan[] } {
  const v = validate(translated, block)
  if (!v.ok) throw new PlaceholderIntegrityError(v.reason, v.detail)

  const fragment = doc.createDocumentFragment()
  const stack: (DocumentFragment | Element)[] = [fragment]
  const top = () => stack[stack.length - 1]!
  const spans: WireSpan[] = []
  /** Which slot each clone stands for; the label restore checks identities, not just counts */
  const ids = new Map<Node, number>()

  for (const t of scanTokens(translated, block.format)) {
    if (t.kind === 'text') {
      // `scanTokens` has already resolved entities and `@@`; decoding again would eat a literal one
      const node = doc.createTextNode(t.text)
      top().append(node)
      spans.push({ kind: 'text', node, from: t.from, to: t.to, anchors: t.anchors })
    } else if (t.kind === 'void') {
      const node = cloneWithoutIds(doc, block.slots.get(t.id)!, true)
      top().append(node)
      ids.set(node, t.id)
      spans.push({ kind: 'slot', node, from: t.from, to: t.to, role: 'void' })
    } else if (t.kind === 'open') {
      const el = cloneWithoutIds(doc, block.slots.get(t.id)!, false) as Element
      top().append(el)
      stack.push(el)
      spans.push({ kind: 'slot', node: el, from: t.from, to: t.to, role: 'open' })
    } else {
      const el = top() as Element
      stack.pop()
      spans.push({ kind: 'slot', node: el, from: t.from, to: t.to, role: 'close' })
    }
  }
  // Markers flattened the block's formatting; the one piece that can be put back safely is a
  // label the block opened with (`label.ts`, issue #150). Splits a span where it splits a node
  if (block.format === 'markers') restoreLeadingLabel(fragment, spans, block, doc, ids, alignment)
  return Object.assign(fragment, { offsets: spans })
}
