// Paper-level context (DESIGN §8.2): the title and the abstract, taken once at page load (no translations in the DOM
// yet; taken after a translation, the previous round's translations would count into the abstract) and carried by
// every batch's prompt. Read Frog calls the LLM once more to summarise a web page; a paper brings its abstract, used directly.
import { AXT_CLASS_PREFIX } from '@/core/marks'
import { collectText, squash } from '@/core/text'
import { ABSTRACT, DOCUMENT_ROOT, DOCUMENT_TITLE, classify } from '@/core/rules/latexml'

/** Where the abstract is cut: it travels with every batch, and a long one is wasted tokens */
export const ABSTRACT_MAX_CHARS = 1200

export interface PaperContext {
  paperTitle?: string
  abstract?: string
}

/** LaTeXML's <math> carries an <annotation> with the TeX source, and textContent would read every formula twice; the presentation text only */
const HIDDEN_MATH_META = new Set(['annotation', 'annotation-xml'])

/**
 * Elements that must not enter the context:
 * - the rules' skip items (publication metadata, conversion errors …): 2507.00150 nests .ltx_pubnotes inside the
 *   document title, and unskipped the whole acknowledgement would pass for the title, sent with every batch and
 *   entering the cache key (Codex on #28)
 * - our own injected nodes (class starting with axt-, hard rule 5): taken after a translation, the previous round's
 *   translations would mix into the abstract
 */
function excluded(el: Element): boolean {
  if (HIDDEN_MATH_META.has(el.localName)) return true
  if (Array.from(el.classList).some(c => c.startsWith(AXT_CLASS_PREFIX))) return true
  return classify(el)?.kind === 'skip'
}

function text(el: Element | null | undefined): string {
  return el ? squash(collectText(el, excluded)) : ''
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
