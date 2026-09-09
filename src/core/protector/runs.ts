// Runs path (DESIGN §6.5): split at void nodes, merge paired text into runs (losing styling), translate, then reassemble in original order.
//
// **Functional elements must retain more than text** (issue #44): lost styling is readable; lost links are unusable.
// Treat these elements as void on this path: preserve the entire element without translating its text. Fallback is already lossy;
// preserving behavior matters more than translating a few extra words. None of the 4,221 blocks in 12 fixtures contained such links
// (arXiv body links are .ltx_ref or mailto, already protected by rules). This is a structural guarantee and a fallback for other sites in v2.
import { FUNCTIONAL_INLINE } from '@/core/rules/latexml'
import { cloneWithoutIds } from './clone'
import type { ProtectedBlock } from './serialize'
import { decodeText } from './text'
import { tokenize } from './tokens'

export type RunItem =
  | { kind: 'text'; run: number }
  | { kind: 'void'; id: number }
  /** Whitespace-only run: preserve without sending for translation. */
  | { kind: 'raw'; text: string }

export interface RunLayout {
  items: RunItem[]
  /** Unescaped plain-text runs, in items order. */
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
      runs.push(decodeText(buffer))
    } else {
      items.push({ kind: 'raw', text: decodeText(buffer) })
    }
    buffer = ''
  }
  const isFunctional = (id: number) => {
    const node = block.slots.get(id)
    return node?.nodeType === 1 && (node as Element).matches(FUNCTIONAL_INLINE)
  }
  // Track nesting depth when skipping a paired subtree; an inner </t> must not end the skip early.
  let skipDepth = 0
  for (const t of tokenize(block.text)) {
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
      // Preserve functional elements like void nodes, skipping their entire contents.
      flush()
      items.push({ kind: 'void', id: t.id })
      skipDepth = 1
    }
    // Other open / close tokens: discard paired tags; their text is already in buffer.
  }
  flush()
  return { items, runs }
}

export function joinRuns(translatedRuns: string[], layout: RunLayout, block: ProtectedBlock, doc: Document): DocumentFragment {
  if (translatedRuns.length !== layout.runs.length) {
    throw new Error(`Run count mismatch: expected ${layout.runs.length}, got ${translatedRuns.length}`)
  }
  const fragment = doc.createDocumentFragment()
  for (const item of layout.items) {
    if (item.kind === 'text') fragment.append(doc.createTextNode(translatedRuns[item.run]!))
    else if (item.kind === 'raw') fragment.append(doc.createTextNode(item.text))
    else fragment.append(cloneWithoutIds(doc, block.slots.get(item.id)!, true))
  }
  return fragment
}
