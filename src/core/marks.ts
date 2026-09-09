// Shared injected-node marker: translations, mirrors, and split copies carry axt-t (CLAUDE.md hard rule 5).
// Defined at core level: extractor and protector must ignore these nodes, already inside originals on retranslation,
// without depending on renderer.
export const T_CLASS = 'axt-t'
/**
 * Image overlays (DESIGN §15.2) use a third marker, without axt-t. That class would put them in the side grid's right column,
 * remove paired <img> originals when splitting figures, suppress mirrors, and apply twenty style presets. These are injected nodes, not translation nodes.
 */
export const IMG_CLASS = 'axt-img'
/** Selector shared by extraction, serialization, clone cleanup, and restoration for all injected nodes. */
export const INJECTED_SELECTOR = `.${T_CLASS}, .${IMG_CLASS}`

/** Whether a node is injected (translation / mirror / split copy / image overlay); extraction and serialization skip these. */
export function isInjected(el: Element): boolean {
  return el.classList.contains(T_CLASS) || el.classList.contains(IMG_CLASS)
}

/** Prefix for all injected attributes (CLAUDE.md hard rule 5). */
export const AXT_ATTR_PREFIX = 'data-axt-'

/**
 * Before inserting a clone, remove existing injected nodes (other translations / mirrors may have been copied wholesale).
 * Strip IDs to avoid duplicate anchors (§6.4), and all data-axt-* markers (original blocks and rehydrated footnotes may carry them).
 * Mirroring, translated tables, rehydration, and figure splitting once had near-duplicate implementations that drifted (issue #46); now shared.
 * `includeRoot=false` keeps a newly created translation shell and cleans only its imported descendants.
 */
export function stripInjected(root: Element, includeRoot = true): void {
  for (const stale of Array.from(root.querySelectorAll(INJECTED_SELECTOR))) stale.remove()
  const targets = Array.from(root.querySelectorAll('*'))
  if (includeRoot) targets.unshift(root)
  for (const el of targets) {
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) if (name.startsWith(AXT_ATTR_PREFIX)) el.removeAttribute(name)
  }
}
