// Side-mode mirrors (DESIGN §7.2): copy untranslated left-column content into the right column,
// avoiding empty right cells or left content spanning both columns and breaking alignment.
//
// Structural classification, not a class list: mirror direct children without a pair or translations inside.
// The initial .ltx_equation / .ltx_graphics list missed equally untranslated bibliography numbers,
// author names, and list markers (observed in 2609.00097).
//
// Generate immediately after marking blocks, without waiting for translations. CSS controls visibility thereafter,
// so switching mode still changes just one <html> attribute.
import { DOCUMENT_ROOT, MARGIN_ASIDE } from '@/core/rules/latexml'
import { ID_ATTR } from '@/core/extractor'
import { INJECTED_SELECTOR, isInjected, stripInjected } from '@/core/marks'
import { FOR_ATTR, T_CLASS } from './index'
import { MIRROR_CONTAINER, SIDE_STACK, isMirrorContainer } from './side-layout'

export const MIRROR_CLASS = 'axt-mirror'
/** Mirror data-axt-for prefix, distinct from real block IDs. */
const MIRROR_ID_PREFIX = 'mirror:'
/** Elements without text or this content do not need mirrors (decoration / whitespace). */
const MEDIA = 'img, svg, object, math, table, canvas, video'

function needsMirror(child: Element): boolean {
  // Never mirror injected nodes (translations, mirrors, overlays).
  if (isInjected(child)) return false
  // ar5iv margin notes and publication metadata already float outside the page; mirroring only duplicates them (§7.2).
  if (child.matches(MARGIN_ASIDE)) return false
  // Translation units either have a translation or await one; neither needs a mirror.
  if (child.hasAttribute(ID_ATTR)) return false
  // An adjacent translation or overlay already forms a pair (§15.2), filling the right column.
  const next = child.nextElementSibling
  if (next && isInjected(next)) return false
  // Elements containing translations are containers; handle their children separately.
  if (child.querySelector(INJECTED_SELECTOR)) return false
  // Do not clone containers with pending blocks, or later translations would duplicate the copied content.
  // This guard requires complete block marking; it cannot distinguish unmarked translation units from permanently static content.
  // run.ts guarantees this by marking synchronously in startTranslation before the first side-prep pass (issue #67).
  if (child.querySelector(`[${ID_ATTR}]`)) return false
  return /\S/.test(child.textContent ?? '') || child.querySelector(MEDIA) !== null || child.matches(MEDIA)
}

/**
 * Mirror unpaired content within containers, idempotently.
 * Return the number of mirrors created.
 */
export function createMirrors(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  // The translation root must also contain translations or marked blocks to qualify as a container. Otherwise, before startup,
  // top-level abstracts / sections with neither would be copied wholesale into the right column (observed full-page duplication).
  if (!isMirrorContainer(scope)) return 0
  const containers = [scope, ...Array.from(scope.querySelectorAll(MIRROR_CONTAINER))].filter(isMirrorContainer)
  let made = 0
  for (const container of containers) {
    if (container.classList.contains(MIRROR_CLASS)) continue
    // Stacked regions have no right column; mirrors would duplicate content vertically (2312.17141 multi-panel figure).
    if (container.closest(SIDE_STACK)) continue
    for (const child of Array.from(container.children)) {
      if (!needsMirror(child)) continue
      const clone = child.cloneNode(true) as Element
      // Cloned mirrors must not retain IDs, block markers, or other translations.
      stripInjected(clone)
      clone.classList.add(T_CLASS, MIRROR_CLASS)
      // Mirrors only balance columns visually; their content is identical to the left. Hide them from screen readers
      // to avoid reading each image or formula twice.
      // inert is also required (A/B audit of 2401.00596, issue #72). aria-hidden alone leaves cloned links in the Tab order,
      // including bibliography DOI / arXiv links. Keyboard focus would enter a decorative copy
      // ignored by screen readers, producing no announcement (axe: aria-hidden-focus).
      clone.setAttribute('aria-hidden', 'true')
      clone.setAttribute('inert', '')
      clone.setAttribute(FOR_ATTR, `${MIRROR_ID_PREFIX}${made}`)
      child.after(clone)
      made++
    }
  }
  return made
}
