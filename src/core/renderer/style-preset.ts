// 译文样式预设的 id 与自定义 CSS 的校验（DESIGN §7.5）。规则本身在 src/styles/presets.css。
export const STYLE_PRESETS = [
  'none',
  // 下划线类：由 presets.css 的 --axt-deco 机制驱动，必须同时画到公式等原子行内元素上
  'underline', 'dotted', 'dashed', 'dashed-bold', 'wavy', 'wavy-bold',
  // 边框类
  'box', 'box-dashed', 'quote',
  // 底色类
  'marker', 'marker-gradient', 'highlight', 'tint',
  // 文字类
  'muted', 'green', 'gradient', 'colorful',
  // 动效与其他
  'blur', 'glow', 'blink',
  'custom',
] as const

export type StylePreset = (typeof STYLE_PRESETS)[number]

/** 下划线类：presets.css 里有一条共享规则同时作用到译文与其中的 math / inline-block（§7.5） */
export const DECORATION_PRESETS: readonly StylePreset[] = ['underline', 'dotted', 'dashed', 'dashed-bold', 'wavy', 'wavy-bold']

export const STYLE_ATTR_NAME = 'data-axt-style'

/** 自定义 CSS 的选择器由我们给出，用户只填花括号里的声明 */
// 与 presets.css 同一条界线：加载圆环、失败控件、side 模式的镜像与拆分克隆都带 .axt-t，但都不是译文
/** 「真正的译文」这条界线：与 presets.css 每一行、split-figures.ts 的 REAL_TRANSLATION 必须一致 */
export const TRANSLATION_SELECTOR = 'html[data-axt-on] .axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)'

export const CUSTOM_STYLE_SELECTOR = 'html[data-axt-style="custom"] .axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)'

/**
 * 用户写的是**声明块**，不是完整规则：整段插进一对花括号中间。
 * 因此 `}` 要拒——它会提前闭合我们的规则，后面的内容就变成了作用于整页的规则；
 * `@`（at 规则）与 `<`（`</style>`）同理。这不是安全边界（用户本来就能装任何扩展），
 * 是防手滑：一个多余的花括号会把整篇论文的排版改掉，而且很难看出原因。
 */
export function sanitizeCustomCss(css: string): { ok: true; css: string } | { ok: false; reason: string } {
  const trimmed = css.trim()
  if (trimmed === '') return { ok: true, css: '' }
  for (const [char, reason] of [['}', '不要写右花括号：这里只填声明，选择器由扩展补上'], ['{', '不要写左花括号：这里只填声明，选择器由扩展补上'], ['@', '不支持 @ 规则'], ['<', '不能包含 <']] as const) {
    if (trimmed.includes(char)) return { ok: false, reason }
  }
  return { ok: true, css: trimmed }
}

/** 拼成可注入的规则；空串返回空串（不产生空规则） */
export function customStyleRule(css: string): string {
  const sanitized = sanitizeCustomCss(css)
  if (!sanitized.ok || sanitized.css === '') return ''
  return `${CUSTOM_STYLE_SELECTOR} {\n${sanitized.css}\n}\n`
}

/** 用户可调的装饰参数（§7.5）：文字颜色、透明度、高亮色。空 / 默认值不产生声明 */
export interface StyleVars {
  /** 空串 = 跟随原文 */
  color?: string
  /** 1 = 不透明（默认） */
  opacity?: number
  /** 空串 = 用 presets.css 里那个跟随正文色的默认强调色 */
  accent?: string
}

/**
 * 颜色值白名单。用户可以手填，所以要挡住把值当成声明写下去的手滑与注入：
 * `;` 会开出新声明、`}` 会提前闭合规则、`(` 嵌套留给 `color-mix` 之外的函数没必要。
 * 放行的形状：`#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`、CSS 具名颜色、以及一层函数记法
 * （`rgb()` `hsl()` `oklch()` `color-mix()` 等，参数里不再套括号）。
 * 设置页用 `<input type="color">`，正常路径产出的就是 `#rrggbb`，白名单只在手填时起作用。
 */
/** 上限放到能装下一条 color-mix()；设置页的取色器产出的是 7 个字符的 #rrggbb */
export const COLOR_MAX = 64

const COLOR_RE = /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\([0-9a-z\s.%,/+-]*\))$/i

export function sanitizeColor(value: string): { ok: true; color: string } | { ok: false; reason: string } {
  const trimmed = value.trim()
  if (trimmed === '') return { ok: true, color: '' }
  if (trimmed.length > COLOR_MAX) return { ok: false, reason: '颜色值太长' }
  if (!COLOR_RE.test(trimmed)) return { ok: false, reason: '不是有效的颜色值，例如 #1565c0 或 oklch(0.6 0.1 250)' }
  return { ok: true, color: trimmed }
}

export const OPACITY_MIN = 0.3
export const OPACITY_MAX = 1

/**
 * 拼成可注入的规则。**必须排在 presets.css 之后**：
 * `muted` / `green` 两个预设也写 `--axt-color`，选择器形状与这里相同、特异度相同，
 * 靠层叠顺序让用户的值赢（`enable()` 的拼接串里就是这个顺序）。同理 `--axt-accent`
 * 覆盖 presets.css 里 `html[data-axt-on]` 上那条默认值。
 *
 * 透明度用排除列表而不是裸 `.axt-t`：镜像与拆图副本是**原文**的视觉克隆、不是译文，
 * 而且克隆里嵌套的真译文仍然匹配，正好只应用一次、不会叠乘（§7.5 的同一条界线）。
 */
export function styleVarsRule(vars: StyleVars): string {
  const color = sanitizeColor(vars.color ?? '')
  const accent = sanitizeColor(vars.accent ?? '')
  const opacity = vars.opacity ?? OPACITY_MAX
  const onDecls: string[] = []
  if (accent.ok && accent.color !== '') onDecls.push(`--axt-accent: ${accent.color};`)
  const textDecls: string[] = []
  if (color.ok && color.color !== '') textDecls.push(`--axt-color: ${color.color};`)
  if (Number.isFinite(opacity) && opacity < OPACITY_MAX) textDecls.push(`opacity: ${Math.max(OPACITY_MIN, opacity)};`)
  let out = ''
  if (onDecls.length > 0) out += `html[data-axt-on] {\n${onDecls.join('\n')}\n}\n`
  if (textDecls.length > 0) out += `${TRANSLATION_SELECTOR} {\n${textDecls.join('\n')}\n}\n`
  return out
}
