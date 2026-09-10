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
  }
}

export function bandTile(profile: HighlightProfile): CSSProperties {
  return { backgroundColor: `color-mix(in oklab, ${profile.color || 'oklch(0.693 0.17 162.48)'} ${Math.round(profile.opacity * 100)}%, transparent)`, borderRadius: 2 }
}
