// Translation preset IDs and custom CSS validation (DESIGN §7.5). Rules live in src/styles/presets.css.
export const STYLE_PRESETS = [
  'none',
  // Underlines: presets.css's --axt-deco also decorates atomic inline elements such as formulas.
  'underline', 'dotted', 'dashed', 'dashed-bold', 'wavy', 'wavy-bold',
  // Borders.
  'box', 'box-dashed', 'quote',
  // Backgrounds.
  'marker', 'marker-gradient', 'highlight', 'tint',
  // Text.
  'muted', 'green', 'gradient', 'colorful',
  // Animation and other styles.
  'blur', 'glow', 'blink',
  'custom',
] as const

export type StylePreset = (typeof STYLE_PRESETS)[number]

/** Underlines: one shared presets.css rule applies to translations and nested math / inline-block elements (§7.5). */
export const DECORATION_PRESETS: readonly StylePreset[] = ['underline', 'dotted', 'dashed', 'dashed-bold', 'wavy', 'wavy-bold']

export const STYLE_ATTR_NAME = 'data-axt-style'

/** The extension supplies selectors; users enter declarations only. */
// Same boundary as presets.css: spinners, errors, mirrors, and split clones carry .axt-t but are not translations.
export const CUSTOM_STYLE_SELECTOR = 'html[data-axt-style="custom"] .axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)'

/**
 * User CSS is a declaration block, inserted inside our braces, not a full rule.
 * Reject } because it closes our rule early and lets following rules affect the whole page;
 * likewise @ (at-rules) and < (</style>). This is not a security boundary (users can install extensions),
 * but an editing guard: one stray brace can alter the entire paper's layout with no obvious cause.
 */
export function sanitizeCustomCss(css: string): { ok: true; css: string } | { ok: false; reason: string } {
  const trimmed = css.trim()
  if (trimmed === '') return { ok: true, css: '' }
  for (const [char, reason] of [['}', 'Do not include closing braces: enter declarations only; the extension supplies the selector'], ['{', 'Do not include opening braces: enter declarations only; the extension supplies the selector'], ['@', '@ rules are not supported'], ['<', 'Cannot contain <']] as const) {
    if (trimmed.includes(char)) return { ok: false, reason }
  }
  return { ok: true, css: trimmed }
}

/** Build an injectable rule; empty input returns empty output, not an empty rule. */
export function customStyleRule(css: string): string {
  const sanitized = sanitizeCustomCss(css)
  if (!sanitized.ok || sanitized.css === '') return ''
  return `${CUSTOM_STYLE_SELECTOR} {\n${sanitized.css}\n}\n`
}
