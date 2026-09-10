// The appearance contract (DESIGN §7.5): which attributes go on <html> and which variables the
// injected sheet writes. The rules themselves are in src/styles/presets.css.
//
// v12 replaced the 21 fixed presets by the reader's own profiles: a profile is a colour, an
// opacity, an underline, a blur flag and a block of declarations, so the sheet has three rules
// instead of twenty and every value arrives as a variable.
import type { Look } from '@/config/appearance'
import { HL_OPACITY_MAX, HL_OPACITY_MIN } from '@/config/appearance'
import { OPACITY_MAX, OPACITY_MIN, sanitizeColor, sanitizeCustomCss } from './style-values'

export { COLOR_MAX, OPACITY_MAX, OPACITY_MIN, sanitizeColor, sanitizeCustomCss } from './style-values'

/** The active profile's underline, absent when it has none */
export const UNDERLINE_ATTR = 'data-axt-underline'
/** Present when the active profile blurs the translation until it is hovered */
export const BLUR_ATTR = 'data-axt-blur'

/** 自定义 CSS 的选择器由我们给出，用户只填花括号里的声明 */
// 与 presets.css 同一条界线：加载圆环、失败控件、side 模式的镜像与拆分克隆都带 .axt-t，但都不是译文
/** 「真正的译文」这条界线：与 presets.css 每一行、split-figures.ts 的 REAL_TRANSLATION 必须一致 */
export const TRANSLATION_SELECTOR = 'html[data-axt-on] .axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)'

/**
 * 「不是任何**真**译文的后代」的真译文。透明度必须用它，不能用 TRANSLATION_SELECTOR：
 * side 模式的 `localizeNotes()` 会把脚注译文（`.axt-note-t.axt-t`）插进段落译文内部，
 * 两层都匹配的话 opacity 会相乘——下限 0.3 会渲染成 0.09，几乎看不见（Codex 在 #106 指出）。
 * 内层用 :where() 压掉特异度贡献。拆图副本本身被排除，所以副本**里**的真译文仍然拿到一次透明度
 */
const NESTED = '.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)'
export const TOP_TRANSLATION_SELECTOR = `${TRANSLATION_SELECTOR}:not(:where(${NESTED}) *)`

/**
 * The reader's own declarations apply to the active profile whatever else it sets: v12 made them a
 * field of every profile rather than a preset of their own, so there is no `custom` id to key on
 */
export const CUSTOM_STYLE_SELECTOR = TRANSLATION_SELECTOR


/** 拼成可注入的规则；空串返回空串（不产生空规则） */
export function customStyleRule(css: string): string {
  const sanitized = sanitizeCustomCss(css)
  if (!sanitized.ok || sanitized.css === '') return ''
  return `${CUSTOM_STYLE_SELECTOR} {\n${sanitized.css}\n}\n`
}

/**
 * The injected rules for one look, **in two pieces** — they belong on either side of presets.css
 * (Codex on #106):
 *
 * - `base` goes **before** presets.css: `--axt-opacity` and the baseline `opacity` declaration, so
 *   the blur rule (which has an opacity of its own) can multiply the reader's value into its own
 *   formula instead of having the slider silently do nothing.
 * - `overrides` goes **after**: the colour and the band variables, so they win over anything the
 *   sheet sets by cascade order rather than by specificity.
 *
 * Opacity uses `TOP_TRANSLATION_SELECTOR` (the outermost real translation), the colour
 * `TRANSLATION_SELECTOR`: `--axt-color` is inherited and does not stack, `opacity` multiplies.
 */
export function appearanceRule(look: Look): { base: string; overrides: string } {
  const color = sanitizeColor(look.style.color)
  const band = sanitizeColor(look.highlight.color)
  const opacity = look.style.opacity
  const dimmed = Number.isFinite(opacity) && opacity < OPACITY_MAX
  const base = dimmed
    ? `${TOP_TRANSLATION_SELECTOR} {\n--axt-opacity: ${Math.max(OPACITY_MIN, opacity)};\nopacity: var(--axt-opacity, 1);\n}\n`
    : ''

  // The band's strength is a percentage for `color-mix`, clamped the way the schema clamps it
  const mix = Math.round(Math.min(HL_OPACITY_MAX, Math.max(HL_OPACITY_MIN, look.highlight.opacity)) * 100)
  const on = [`--axt-hl-mix: ${mix}%;`]
  if (band.ok && band.color !== '') on.push(`--axt-hl-color: ${band.color};`)
  if (look.style.underline !== 'none' && look.style.thickness === 2) on.push('--axt-deco-thickness: 2px;')
  let overrides = `html[data-axt-on] {\n${on.join('\n')}\n}\n`
  if (color.ok && color.color !== '') overrides += `${TRANSLATION_SELECTOR} {\n--axt-color: ${color.color};\n}\n`
  return { base, overrides }
}
