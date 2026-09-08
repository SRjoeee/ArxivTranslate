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

/**
 * 「不是任何**真**译文的后代」的真译文。透明度必须用它，不能用 TRANSLATION_SELECTOR：
 * side 模式的 `localizeNotes()` 会把脚注译文（`.axt-note-t.axt-t`）插进段落译文内部，
 * 两层都匹配的话 opacity 会相乘——下限 0.3 会渲染成 0.09，几乎看不见（Codex 在 #106 指出）。
 * 内层用 :where() 压掉特异度贡献。拆图副本本身被排除，所以副本**里**的真译文仍然拿到一次透明度
 */
const NESTED = '.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)'
export const TOP_TRANSLATION_SELECTOR = `${TRANSLATION_SELECTOR}:not(:where(${NESTED}) *)`

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
  /** 空串 = 用每个预设自己的默认色：下划线族的 --axt-accent 跟随正文，marker / highlight / glow 的 --axt-green 是固定的绿 */
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

/**
 * CSS 命名颜色。逐个用真实 Chrome 的 `CSS.supports('color', name)` 核验过，不是凭记忆写的。
 * 不收 `inherit` / `initial` / `unset` / `revert`：`CSS.supports` 认它们（属性层面合法），但它们不是颜色。
 * 用静态表而不是 `CSS.supports`，因为后者在 service worker 里不存在（schema 校验要在那边跑），
 * 而且 happy-dom 的实现对任何字符串都返回 true——拿它写测试会得到一条什么都不验的断言
 */
const NAMED_COLORS = new Set(`
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown
  burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson currentcolor cyan darkblue
  darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
  darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise
  darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia
  gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory
  khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
  lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
  midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
  slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise
  violet wheat white whitesmoke yellow yellowgreen
`.trim().split(/\s+/))

// 三个分支：十六进制（只认 3/4/6/8 位）、命名颜色（精确表）、颜色函数。
// **函数分支只做词法检查**，不验语法：Chrome 支持相对颜色 `rgb(from red r g b)` 与嵌套 `color-mix()`，
// 用正则去验参数只会把合法的新写法挡在外面——那比放过一个不生效的值更糟。
// 这一层的硬要求是「不能开出新声明、不能闭合规则」（注入安全），那由字符集与整串锚定保证
const COLOR_FN_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\([0-9a-z\s.%,/+-]*\)$/i
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const isColor = (v: string) => HEX_RE.test(v) || NAMED_COLORS.has(v.toLowerCase()) || COLOR_FN_RE.test(v)

export function sanitizeColor(value: string): { ok: true; color: string } | { ok: false; reason: string } {
  const trimmed = value.trim()
  if (trimmed === '') return { ok: true, color: '' }
  if (trimmed.length > COLOR_MAX) return { ok: false, reason: '颜色值太长' }
  if (!isColor(trimmed)) return { ok: false, reason: '不是有效的颜色值，例如 #1565c0 或 oklch(0.6 0.1 250)' }
  return { ok: true, color: trimmed }
}

export const OPACITY_MIN = 0.3
export const OPACITY_MAX = 1

/**
 * 拼成可注入的规则，**分两段**——它们要落在预设的两侧（Codex 在 #106 指出）：
 *
 * - `base` 排在 presets.css **之前**：`--axt-opacity` 与基线的 `opacity` 声明。这样 `blur`
 *   （自带 `opacity: 0.75`）与 `blink`（关键帧动画改 opacity，动画永远压过普通声明）
 *   既能覆盖基线，又能在自己的公式里乘上用户的值，而不是让滑杆对它们完全失效。
 * - `overrides` 排在 presets.css **之后**：颜色三件套。`muted` / `green` 也写 `--axt-color`，
 *   选择器形状与特异度相同，靠层叠顺序让用户的值赢。
 *
 * 透明度用 `TOP_TRANSLATION_SELECTOR`（顶层真译文），颜色用 `TRANSLATION_SELECTOR`：
 * `--axt-color` 是继承属性，嵌套不叠加；`opacity` 会相乘。
 */
export function styleVarsRule(vars: StyleVars): { base: string; overrides: string } {
  const color = sanitizeColor(vars.color ?? '')
  const accent = sanitizeColor(vars.accent ?? '')
  const opacity = vars.opacity ?? OPACITY_MAX
  const dimmed = Number.isFinite(opacity) && opacity < OPACITY_MAX
  const value = Math.max(OPACITY_MIN, opacity)

  const base = dimmed
    ? `${TOP_TRANSLATION_SELECTOR} {\n--axt-opacity: ${value};\nopacity: var(--axt-opacity, 1);\n}\n`
    : ''

  const onDecls: string[] = []
  // 两个装饰色角色都要写：--axt-accent 管下划线与边框族，--axt-green 管 marker / highlight / glow / green。
  // 只写前者的话，「高亮颜色」这个控件恰恰对叫「高亮」的那几个预设无效（Codex 在 #106 指出）。
  // colorful / gradient 是刻意的多色装饰，不参与
  if (accent.ok && accent.color !== '') onDecls.push(`--axt-accent: ${accent.color};`, `--axt-green: ${accent.color};`)
  let overrides = ''
  if (onDecls.length > 0) overrides += `html[data-axt-on] {\n${onDecls.join('\n')}\n}\n`
  if (color.ok && color.color !== '') overrides += `${TRANSLATION_SELECTOR} {\n--axt-color: ${color.color};\n}\n`
  return { base, overrides }
}
