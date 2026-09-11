// Value sanitisers shared by the config schema and the renderer: colours the reader may
// type, and the CSS declaration block of a style profile (DESIGN §7.5). Kept apart from the
// rule builders so config/appearance.ts can import them without a cycle.

/**
 * 用户写的是**声明块**，不是完整规则：整段插进一对花括号中间。
 * 因此 `}` 要拒——它会提前闭合我们的规则，后面的内容就变成了作用于整页的规则；
 * `@`（at 规则）与 `<`（`</style>`）同理。这不是安全边界（用户本来就能装任何扩展），
 * 是防手滑：一个多余的花括号会把整篇论文的排版改掉，而且很难看出原因。
 */
/** 拒绝的理由**是哪一种**；句子在语言包里，这一层不认识界面语言（Codex 在 #161 指出） */
export type CssRejection = 'closeBrace' | 'openBrace' | 'atRule' | 'angle'

export function sanitizeCustomCss(css: string): { ok: true; css: string } | { ok: false; reason: CssRejection } {
  const trimmed = css.trim()
  if (trimmed === '') return { ok: true, css: '' }
  for (const [char, reason] of [['}', 'closeBrace'], ['{', 'openBrace'], ['@', 'atRule'], ['<', 'angle']] as const) {
    if (trimmed.includes(char)) return { ok: false, reason }
  }
  return { ok: true, css: trimmed }
}

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
