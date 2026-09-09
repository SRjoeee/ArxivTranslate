// Paper context (DESIGN §8.2): extract title and abstract once on page load, before translations exist; otherwise old translations enter the abstract. Include in every prompt batch.
// Read Frog makes an extra LLM call to summarize a page; papers already provide an abstract.
import { ABSTRACT, DOCUMENT_ROOT, DOCUMENT_TITLE, classify } from '@/core/rules/latexml'

/** Abstract length cap: every batch includes it, so excess text wastes tokens. */
export const ABSTRACT_MAX_CHARS = 1200

export interface PaperContext {
  paperTitle?: string
  abstract?: string
}

/** LaTeXML stores TeX in <annotation> inside <math>; textContent duplicates formulas. Read only presentation text. */
const HIDDEN_MATH_META = new Set(['annotation', 'annotation-xml'])

/**
 * Elements excluded from context:
 * - Rule exclusions (publication metadata, conversion errors, etc.): 2507.00150 nests .ltx_pubnotes in its title.
 *   Without this filter, acknowledgements enter the title, every batch, and cache keys (Codex #28).
 * - Injected nodes (axt- classes, hard rule 5): re-extraction must not include previous translations in the abstract.
 */
function excluded(el: Element): boolean {
  if (HIDDEN_MATH_META.has(el.localName)) return true
  if (Array.from(el.classList).some(c => c.startsWith('axt-'))) return true
  return classify(el)?.kind === 'skip'
}

function text(el: Element | null | undefined): string {
  if (!el) return ''
  const parts: string[] = []
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) parts.push((child as Text).data)
      else if (child.nodeType === 1 && !excluded(child as Element)) walk(child)
    }
  }
  walk(el)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max).replace(/\s+\S*$/, '')}...`
}

export function paperContext(doc: Document): PaperContext {
  const root = doc.querySelector(DOCUMENT_ROOT) ?? doc
  const title = text(root.querySelector(DOCUMENT_TITLE))
  const block = root.querySelector(ABSTRACT.root)
  const abstract = block
    ? Array.from(block.children).filter(child => !child.matches(ABSTRACT.title) && !excluded(child)).map(text).filter(Boolean).join(' ')
    : ''
  return {
    ...(title ? { paperTitle: title } : {}),
    ...(abstract ? { abstract: clip(abstract, ABSTRACT_MAX_CHARS) } : {}),
  }
}
