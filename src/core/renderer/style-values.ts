// Value sanitisers shared by the config schema and the renderer: colours the reader may
// type, and the CSS declaration block of a style profile (DESIGN §7.5). Kept apart from the
// rule builders so config/appearance.ts can import them without a cycle.

/**
 * What the reader writes is a **declaration block**, not a whole rule: it goes between one pair of braces.
 * So `}` is refused — it would close our rule early and turn what follows into rules over the whole page; `@` (an
 * at-rule) and `<` (`</style>`) likewise. Not a security boundary (the reader can install any extension anyway) but
 * a guard against slips: one stray brace would change the whole paper's layout, and the cause is hard to spot.
 */
/** **Which kind** of refusal; the sentences live in the locale pack, and this layer knows no interface language (Codex on #161) */
export type CssRejection = 'closeBrace' | 'openBrace' | 'atRule' | 'angle'

export function sanitizeCustomCss(css: string): { ok: true; css: string } | { ok: false; reason: CssRejection } {
  const trimmed = css.trim()
  if (trimmed === '') return { ok: true, css: '' }
  for (const [char, reason] of [['}', 'closeBrace'], ['{', 'openBrace'], ['@', 'atRule'], ['<', 'angle']] as const) {
    if (trimmed.includes(char)) return { ok: false, reason }
  }
  return { ok: true, css: trimmed }
}

/** The cap leaves room for one color-mix(); the settings page's colour picker produces a 7-character #rrggbb */
export const COLOR_MAX = 64

/**
 * The CSS named colours. Each checked against a real Chrome's `CSS.supports('color', name)`, not written from memory.
 * `inherit` / `initial` / `unset` / `revert` are not admitted: `CSS.supports` accepts them (valid at the property
 * level) but they are not colours. A static table rather than `CSS.supports` because the latter does not exist in a
 * service worker (the schema validation runs there), and happy-dom's returns true for any string — a test written
 * on it would assert nothing
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

// Three branches: hexadecimal (3/4/6/8 digits only), a named colour (the exact table), a colour function.
// **The function branch is lexical only** and validates no syntax: Chrome supports relative colours
// `rgb(from red r g b)` and nested `color-mix()`, and a regex over the arguments would only shut out valid new
// forms — worse than letting an ineffective value through. This layer's hard requirement is “cannot open a new
// declaration, cannot close the rule” (injection safety), which the character set and the whole-string anchoring guarantee
const COLOR_FN_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\([0-9a-z\s.%,/+-]*\)$/i
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const isColor = (v: string) => HEX_RE.test(v) || NAMED_COLORS.has(v.toLowerCase()) || COLOR_FN_RE.test(v)

export function sanitizeColor(value: string): { ok: true; color: string } | { ok: false; reason: string } {
  const trimmed = value.trim()
  if (trimmed === '') return { ok: true, color: '' }
  if (trimmed.length > COLOR_MAX) return { ok: false, reason: 'colour value too long' }
  if (!isColor(trimmed)) return { ok: false, reason: 'not a valid colour value, such as #1565c0 or oklch(0.6 0.1 250)' }
  return { ok: true, color: trimmed }
}

export const OPACITY_MIN = 0.3
export const OPACITY_MAX = 1
