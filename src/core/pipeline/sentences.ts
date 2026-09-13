// Which blocks get their sentences cut, and where (§8.6, issue #105).
//
// **The cut points are computed at this layer, not in the service.** The service has only the wire text, while
// choosing the cuts needs the block itself: `sentenceCuts` needs a `SplitContext` built from the placeholder slots
// to tell an “annotation” from a “formula” — a sentence-final full stop may hide inside a math node, and a `\citet`
// placeholder is itself the sentence's subject — and its measured precision expressly excludes reference blocks,
// whose module documentation says callers must not run it there (Codex on #137 pointed out both).
//
// The service takes the cut points and inserts the markers, nothing more.

import type { Segment } from './batches'
import { ANNOTATION_SELECTOR } from '@/core/rules/latexml'
import { sentenceCuts, visibleTextOf } from '@/core/sentences'
import { wireFormatOf, type RenderPath } from '@/cache/key'

/**
 * Reference units. The sentence splitter has no precision guarantee here — journal abbreviations (`Sci. Rep. 14
 * (2024)`, `Theor. Comput. Sci.`) cut false boundaries, and a false boundary puts the highlight on half a sentence, worse than none.
 */
const NO_SENTENCES = new Set(['bibblock', 'bibitem'])

/**
 * This block's sentence boundaries.
 *
 * **An empty array and undefined are not the same**: an empty array says “this block is aligned, and it is one
 * sentence” — whole block to whole block is a safe alignment needing no marker, and single-sentence blocks are most
 * of a body; undefined says “this block is not aligned”, which is where references and the non-`tags` paths fall
 * (Codex on #137 pointed out that I had conflated the two).
 *
 * The `runs` and `markers` paths are not cut: the former sends fragmented plain-text runs and joining them back
 * yields no wire offsets, the latter has no marker that survives the wire.
 */
export function cutsOf(segment: Segment, renderPath: RenderPath): number[] | undefined {
  if (renderPath !== 'tags') return undefined
  if (segment.block.kind === 'text' && NO_SENTENCES.has(segment.block.unit)) return undefined
  const slots = segment.protected.slots
  const cuts = sentenceCuts(segment.protected.text, wireFormatOf(renderPath), {
    isAnnotation: id => {
      const node = slots.get(id)
      return node?.nodeType === 1 && (node as Element).matches(ANNOTATION_SELECTOR)
    },
    textOf: id => {
      const node = slots.get(id)
      return node ? visibleTextOf(node) : undefined
    },
  })
  return cuts
}
