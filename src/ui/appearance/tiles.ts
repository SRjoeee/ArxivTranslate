// What a profile looks like on its grid tile: the same values the page uses, as inline style, so
// a tile needs no iframe of its own (there are up to fifty of them on the page).
import type { CSSProperties } from 'react'
import type { HighlightProfile, StyleProfile } from '@/config/appearance'

export function styleTile(profile: StyleProfile): CSSProperties {
  const color = profile.color || 'inherit'
  return {
    color,
    opacity: profile.opacity,
    ...(profile.underline === 'none'
      ? {}
      : { textDecoration: `underline ${profile.underline} ${color === 'inherit' ? 'currentColor' : color}`, textUnderlineOffset: '0.25em', textDecorationThickness: `${profile.thickness}px` }),
    ...(profile.blur ? { filter: 'blur(2px)' } : {}),
    // The advanced declarations last, as on the page: `customStyleRule` comes after the variables in
    // the injected sheet. A profile whose whole effect is a `font-weight` there would otherwise look
    // exactly like an unstyled one here, which defeats a preview (Codex on #161)
    ...declarations(profile.css),
  }
}

/**
 * Which declarations reach a preview. The configuration's sanitiser only refuses braces, at-rules
 * and `<`, so a profile may legally carry `position: fixed; inset: 0; z-index: 9999` — on the paper
 * that is the reader's own doing, but a **sample inside the popup** would then cover the popup
 * (Codex on #161). A sample is one line of text, so it takes the properties that describe text and
 * leaves the ones that place a box. The paper still gets the whole declaration list
 */
const TEXT_ONLY = /^(--|color$|opacity$|filter$|mix-blend-mode$|font-|letter-spacing$|word-spacing$|line-height$|text-|background|border-bottom|border-radius$|white-space$|font-variant)/

/**
 * A sanitised declaration list — `font-weight: 600; letter-spacing: .02em` — as a style object.
 * A custom property keeps its name; anything else becomes camelCase, which is how React writes it
 */
function declarations(css: string): CSSProperties {
  const out: Record<string, string> = {}
  for (const part of css.split(';')) {
    const at = part.indexOf(':')
    if (at < 0) continue
    const name = part.slice(0, at).trim()
    // `color: red !important` is legal here — the sanitiser only refuses braces, at-rules and `<` —
    // and the injected sheet honours it. CSSOM refuses a priority inside a property value, so the
    // sample would silently lose the declaration; drop the priority and keep the declaration
    // (Codex on #161). A preview has nothing to lose a specificity war with
    const value = part.slice(at + 1).replace(/!\s*important\s*$/i, '').trim()
    if (!name || !value || !TEXT_ONLY.test(name)) continue
    out[name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value
  }
  return out as CSSProperties
}

export function bandTile(profile: HighlightProfile): CSSProperties {
  return { backgroundColor: `color-mix(in oklab, ${profile.color || 'oklch(0.693 0.17 162.48)'} ${Math.round(profile.opacity * 100)}%, transparent)`, borderRadius: 2 }
}
