// Appearance profiles (spec §3): the reader's own list of translation styles and hover bands.
// The built-ins are ordinary entries with fixed ids, so they can be edited, deleted and restored.
import { z } from 'zod'
import { COLOR_MAX, OPACITY_MAX, OPACITY_MIN, sanitizeColor, sanitizeCustomCss } from '@/core/renderer/style-values'
import type { Config } from './schema'

export const UNDERLINES = ['none', 'solid', 'dotted', 'dashed', 'wavy'] as const
export type Underline = (typeof UNDERLINES)[number]
export const HL_OPACITY_MIN = 0.05
export const HL_OPACITY_MAX = 0.6

// The two zod messages here are product copy (shown by the settings page's fallback notice), like those of schema.ts
const colorField = z.string().max(COLOR_MAX).refine(v => sanitizeColor(v).ok, '不是有效的颜色值')
const idField = z.string().min(1).max(40)

export const styleProfileSchema = z.object({
  id: idField,
  name: z.string().min(1).max(40),
  /** '' = follow the original text */
  color: colorField,
  opacity: z.number().min(OPACITY_MIN).max(OPACITY_MAX),
  underline: z.enum(UNDERLINES),
  thickness: z.union([z.literal(1), z.literal(2)]),
  /** Blurred until hovered */
  blur: z.boolean(),
  /** Advanced: declarations only; the selector is the extension's */
  css: z.string().max(2000).refine(v => sanitizeCustomCss(v).ok, '只填声明，不写选择器和花括号'),
})
export type StyleProfile = z.infer<typeof styleProfileSchema>

export const highlightProfileSchema = z.object({
  id: idField,
  name: z.string().min(1).max(40),
  /** '' = the default green */
  color: colorField,
  opacity: z.number().min(HL_OPACITY_MIN).max(HL_OPACITY_MAX),
})
export type HighlightProfile = z.infer<typeof highlightProfileSchema>

export const appearanceSchema = z.object({
  styles: z.array(styleProfileSchema).max(50),
  activeStyle: idField,
  highlights: z.array(highlightProfileSchema).max(50),
  activeHighlight: idField,
})
export type Appearance = z.infer<typeof appearanceSchema>

/** What the renderer needs: the active profile of each list */
export interface Look {
  style: StyleProfile
  highlight: HighlightProfile
}

const style = (id: string, name: string, over: Partial<StyleProfile> = {}): StyleProfile =>
  ({ id, name, color: '', opacity: 1, underline: 'none', thickness: 1, blur: false, css: '', ...over })

/** Read Frog's green (custom-translation-node.css); the others were picked against arXiv's white and its dark theme */
export const GREEN = 'oklch(0.693 0.17 162.48)'
export const BUILT_IN_STYLES: readonly StyleProfile[] = [
  style('follow', '与原文相同'),
  style('green', '绿色', { color: GREEN }),
  style('blue', '蓝色', { color: 'oklch(0.62 0.15 250)' }),
  style('amber', '琥珀', { color: 'oklch(0.7 0.14 70)' }),
  style('muted', '淡一档', { opacity: 0.7 }),
  style('blur', '模糊', { blur: true }),
]
export const BUILT_IN_HIGHLIGHTS: readonly HighlightProfile[] = [
  { id: 'soft-green', name: '柔和绿', color: GREEN, opacity: 0.22 },
  { id: 'sand', name: '淡黄', color: 'oklch(0.85 0.12 85)', opacity: 0.3 },
  { id: 'sky', name: '淡蓝', color: 'oklch(0.75 0.12 240)', opacity: 0.25 },
]
/** Eight swatches for text and bands, readable on both arXiv backgrounds */
export const PALETTE: readonly string[] = [
  GREEN, 'oklch(0.62 0.15 250)', 'oklch(0.7 0.14 70)', 'oklch(0.6 0.18 25)',
  'oklch(0.6 0.16 300)', 'oklch(0.7 0.12 190)', 'oklch(0.55 0.02 260)', 'oklch(0.75 0.12 240)',
]

export const DEFAULT_APPEARANCE: Appearance = { styles: [...BUILT_IN_STYLES], activeStyle: 'follow', highlights: [...BUILT_IN_HIGHLIGHTS], activeHighlight: 'soft-green' }

export const activeStyle = (a: Appearance): StyleProfile => a.styles.find(s => s.id === a.activeStyle) ?? a.styles[0] ?? BUILT_IN_STYLES[0]!
export const activeHighlight = (a: Appearance): HighlightProfile => a.highlights.find(h => h.id === a.activeHighlight) ?? a.highlights[0] ?? BUILT_IN_HIGHLIGHTS[0]!
export const lookOf = (config: Pick<Config, 'appearance'>): Look => ({ style: activeStyle(config.appearance), highlight: activeHighlight(config.appearance) })

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
export function newProfileId(prefix: 'style' | 'hl'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `${prefix}-${Array.from(bytes, b => ID_CHARS[b % ID_CHARS.length]).join('')}`
}

/**
 * Built-ins back to their shipped values, in their shipped order, the reader's own after them.
 * **One list at a time**: the two grids have a reset each, and resetting styles must not quietly
 * discard edits to the bands (Codex on #157)
 */
export function resetBuiltIns(a: Appearance, list: 'styles' | 'highlights'): Appearance {
  if (list === 'styles') {
    const ids = new Set(BUILT_IN_STYLES.map(s => s.id))
    return { ...a, styles: [...BUILT_IN_STYLES, ...a.styles.filter(s => !ids.has(s.id))] }
  }
  const ids = new Set(BUILT_IN_HIGHLIGHTS.map(h => h.id))
  return { ...a, highlights: [...BUILT_IN_HIGHLIGHTS, ...a.highlights.filter(h => !ids.has(h.id))] }
}

/**
 * Duplicate. **The name is the caller's**: it has to be written in the interface language (“绿色 副本” / “Green
 * copy”), and the display names of the profiles shipped with the extension follow the language too — all matters of
 * the UI layer, and the configuration layer knows no locale pack (Codex on #161). The name is still held to the schema's cap here: over it the whole configuration cannot be stored, and the reader only sees “not saved” (Codex on #157)
 */
export const NAME_MAX = 40
export const duplicateStyle = (p: StyleProfile, name: string): StyleProfile => ({ ...p, id: newProfileId('style'), name: name.slice(0, NAME_MAX) })
export const duplicateHighlight = (p: HighlightProfile, name: string): HighlightProfile => ({ ...p, id: newProfileId('hl'), name: name.slice(0, NAME_MAX) })
