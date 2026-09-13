// The document's translation state (DESIGN §7; ADR-0003): the attributes on <html>, the injected
// style sheet, the mode, and the restore that undoes all of it. Global state lives on <html> only (§7.1).
import type { Look } from '@/config/appearance'
import { isRtlTag } from '@/config/languages'
import { AXT_ATTR_PREFIX, INJECTED_SELECTOR } from '@/core/marks'
import highlightCss from '@/styles/highlight.css?inline'
import imageCss from '@/styles/image.css?inline'
import modesCss from '@/styles/modes.css?inline'
import presetsCss from '@/styles/presets.css?inline'
import { BLUR_ATTR, DIR_ATTR, LANG_ATTR, MODE_ATTR, type Mode, ON_ATTR, STYLE_ATTR, UNDERLINE_ATTR } from './attrs'
import { clearSentenceHighlights } from './highlight'
import { cancelSkeletonsIn } from './skeleton'
import { appearanceRule, customStyleRule } from './style-preset'

const STYLE_MARK = 'modes'

/** What the sheet needs: the reader's active style and band profiles (§7.5). `Look` lives with the profiles */
export type { Look }

/**
 * The injected sheet's content. Its order is the cascade order, and two things **must** hold:
 * - `appearanceRule`'s `base` (opacity) comes **before** presetsCss, so the blur rule composes with it instead of
 *   overriding it; `overrides` (colour and highlight variables) come **after**
 * - `customStyleRule` comes last: it is the advanced escape hatch and gets the final word
 */
function styleSheet(look?: Look): string {
  const vars = look ? appearanceRule(look) : { base: '', overrides: '' }
  const custom = look ? customStyleRule(look.style.css) : ''
  return `${modesCss}\n${vars.base}${presetsCss}\n${imageCss}\n${highlightCss}\n${vars.overrides}${custom}`
}

/** The same sheet the page gets, for the settings preview to put in its iframe */
export const appearanceSheet = (look: Look): string => styleSheet(look)

/**
 * Appearance only, no translation node touched (#47): write the profile's switches and recompute the
 * injected sheet. This is the path a colour change in the settings page takes, and it **does not
 * re-request anything** (§8.5's `chainConfigChanged` ignores `style` already). With translation off
 * there is no injected sheet and nothing to do — the next `enable` carries the new values.
 */
export function applyStyle(doc: Document, look: Look): boolean {
  const sheet = doc.querySelector(`style[${STYLE_ATTR}="${STYLE_MARK}"]`)
  if (!sheet) return false
  setAppearanceAttrs(doc, look)
  const css = styleSheet(look)
  if (sheet.textContent !== css) {
    sheet.textContent = css
    // Font size, leading and weight can all change here, and then the line is no longer where the
    // bands were traced. They are absolute boxes in document coordinates and cannot follow a
    // reflow, so drop them; the next pointer move repaints against the new layout (Codex on #138).
    clearSentenceHighlights(doc)
  }
  return true
}

/**
 * Enter the translated state: the state attribute on <html>, the mode and the appearance injected (idempotent).
 * Appearance, like the mode, is only attributes on <html> (§7.5); a configuration change touches no DOM; the
 * advanced CSS is recomputed on every injection
 */
export function enable(doc: Document, mode: Mode, look?: Look, lang?: string): void {
  doc.documentElement.setAttribute(ON_ATTR, '')
  doc.documentElement.setAttribute(MODE_ATTR, mode)
  // The translation's language is recorded on <html> (§7.1: global state lives there only); renderText writes it onto
  // every translation node's lang. Not by changing <html lang>: that would label the original as Chinese as well
  if (lang) {
    doc.documentElement.setAttribute(LANG_ATTR, lang)
    if (isRtlTag(lang)) doc.documentElement.setAttribute(DIR_ATTR, 'rtl')
    else doc.documentElement.removeAttribute(DIR_ATTR)
  }
  if (look) setAppearanceAttrs(doc, look)
  const existing = doc.querySelector(`style[${STYLE_ATTR}="${STYLE_MARK}"]`)
  const css = styleSheet(look)
  if (existing) {
    // The custom CSS may have changed (edited in settings, then translated again): written only when it differs, to spare a needless style recalculation
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const el = doc.createElement('style')
  el.setAttribute(STYLE_ATTR, STYLE_MARK)
  el.textContent = css
  doc.head.append(el)
}

/**
 * The two switches of the active style, as attributes on `<html>` (§7.5). Everything else the
 * profile carries arrives as a variable, so this is all that changes when the reader picks another
 */
function setAppearanceAttrs(doc: Document, look: Look): void {
  const html = doc.documentElement
  if (look.style.underline === 'none') html.removeAttribute(UNDERLINE_ATTR)
  else html.setAttribute(UNDERLINE_ATTR, look.style.underline)
  if (look.style.blur) html.setAttribute(BLUR_ATTR, '')
  else html.removeAttribute(BLUR_ATTR)
}

/** A mode switch changes one attribute and goes through no translation flow (§4 step 9) */
export function setMode(doc: Document, mode: Mode): void {
  // `only` hides the source column outright and `side` re-lays it out, so whatever was tinted is
  // about to be somewhere else or nowhere. The next pointer move repaints it in place.
  clearSentenceHighlights(doc)
  doc.documentElement.setAttribute(MODE_ATTR, mode)
}

/** Restore the original: remove every injected node (translations and image overlays, §7.1 item 4), strip every data-axt-* attribute, remove the injected styles (#axt-debug's included) */
export function restore(doc: Document): { removedNodes: number; strippedAttrs: number } {
  // Nothing to undo in the DOM — the highlight only ever lived in `CSS.highlights` — but the
  // painted ranges point at translation nodes about to be removed (§7.7)
  clearSentenceHighlights(doc)
  let removedNodes = 0
  let strippedAttrs = 0
  for (const node of Array.from(doc.querySelectorAll(INJECTED_SELECTOR))) {
    cancelSkeletonsIn(node)
    node.remove()
    removedNodes++
  }
  // Styles first, attributes after: the style mark is itself a data-axt-* attribute, and once stripped it cannot be found
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
