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
