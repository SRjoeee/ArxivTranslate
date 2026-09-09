// Text inside an SVG figure, recovered exactly (DESIGN §15.5, issue #121).
//
// arXiv's SVG figures carry no `<text>`: every character is an outline, drawn by a `<use>` that
// points at a glyph in `<defs>`. What makes them readable anyway is that each of those `<use>`
// elements is annotated with the character it draws, so the text is *read*, not recognised — the
// error rate is zero rather than whatever OCR would get wrong. Measured over 55064 glyphs in 281
// figures, `data-text` is present on every one that is a glyph (`docs/RESEARCH.md` §6.11).
//
// The output is `OcrLine[]`, the same shape the OCR helper returns, so everything downstream —
// `linesToBoxes`, the translate call, the overlay — is shared with the bitmap path and knows
// nothing about where the lines came from.
//
// **Read-only.** Nothing here writes to the embedded document. The overlay is built in the main
// document from normalised coordinates, which works because a figure's `viewBox` maps linearly onto
// its `<object>` element box (measured to four decimal places, §6.11). §7.1's DOM invariant and
// `restore()` are untouched, and there is no second document to define restore semantics for.

import type { OcrLine, Quad } from '@/shared/ocr'

/** One glyph: what it draws, where, how big, and which way up. */
interface Glyph {
  text: string
  /** Position along the baseline direction, in viewBox units */
  along: number
  /** Position across it — glyphs of one line share this */
  across: number
  size: number
  /** Radians, from the transform matrix. Only 0 and -π/2 occur in the corpus. */
  angle: number
}

/** A run of glyphs sharing a baseline: one label, one tick, one line of a listing. */
export interface GlyphRun {
  text: string
  angle: number
  size: number
  /** Interval along the baseline, in viewBox units */
  from: number
  to: number
  /** Baseline position across, in viewBox units */
  across: number
  glyphs: number
}

/**
 * A gap wider than this many font sizes ends the run.
 *
 * Relative to the font size, not to an advance estimated from the run: advances vary enormously in
 * a proportional face, and a median taken over a few narrow letters breaks `wall time` after
 * `wall tim` because `m` is wide. Measured on the fixtures, gaps on a shared baseline fall into
 * three clearly separated regimes:
 *
 * | | |
 * |---|---|
 * | an ordinary advance | ~0.55 |
 * | a dropped space (one advance too many) | ~1.10 |
 * | an actual break between two labels | ≥ 3.86 |
 *
 * and the widest gap inside any run across both fixtures is 1.19. Anything in (1.2, 3.8) separates
 * them; 1.5 sits there with room on both sides.
 *
 * A dropped space therefore stays inside its run, which is what should happen — the fix for it is
 * to put the space back, not to cut the line in half, and that needs a per-run advance estimate
 * (`docs/RESEARCH.md` §6.11). Out of scope while code figures are skipped, and the failure it would
 * cause here is benign anyway: two very close ticks merging into `0.20.4`, which is numeric and
 * never reaches a translator.
 */
const RUN_BREAK = 1.5

/**
 * Decomposes `transform="matrix(a,b,c,d,e,f)"`.
 *
 * The size is `hypot(a,b)` and the angle `atan2(b,a)` — **not** `a`, which is only the size when
 * the glyph is upright. Reading `a` puts every rotated axis label at size 0 and loses its
 * orientation, and 8.95% of glyphs in the corpus are rotated (§6.11).
 */
function decompose(transform: string | null): { x: number; y: number; size: number; angle: number } | undefined {
  const m = /matrix\(([^)]*)\)/.exec(transform ?? '')
  if (!m) return undefined
  const parts = m[1]!.split(/[\s,]+/).map(Number)
  if (parts.length < 6 || parts.some(n => !Number.isFinite(n))) return undefined
  const [a, b, , , e, f] = parts as [number, number, number, number, number, number]
  const size = Math.hypot(a, b)
  if (size <= 0) return undefined
  return { x: e, y: f, size, angle: Math.atan2(b, a) }
}

/**
 * Whether anything between this glyph and the figure's root carries a transform of its own.
 *
 * A glyph's own matrix is relative to its parent's coordinate system, so a transformed ancestor
 * would make every number derived from it — baseline, angle, size, position — wrong. Measured over
 * every fetchable file in the corpus (276 files, 54344 glyphs): **not one glyph has one**. Grouping
 * itself is common — 21.1% of glyphs sit below the root, nested up to four deep — so the safe
 * statement is not "the converter emits a flat tree" but "it puts the whole transform on the glyph"
 * (Codex asked about the composition on #133).
 *
 * Skipping rather than composing: composition would be untested code for a case that does not occur,
 * and a label placed from a matrix that is missing half its transform lands somewhere arbitrary on
 * the figure. Dropping the run leaves it untranslated, which is the failure the reader can see past.
 */
function underTransformedAncestor(use: Element, root: Element): boolean {
  for (let node = use.parentElement; node && node !== root; node = node.parentElement) {
    if (node.hasAttribute('transform')) return true
  }
  return false
}

/** Glyphs in document order, projected onto their own baseline. */
function glyphsOf(svg: Element): Glyph[] {
  const out: Glyph[] = []
  for (const use of Array.from(svg.querySelectorAll('use[data-text]'))) {
    const text = use.getAttribute('data-text')
    // Entities in the attribute are already decoded by the parser; an empty one draws nothing
    if (text === null || text === '') continue
    if (underTransformedAncestor(use, svg)) continue
    const t = decompose(use.getAttribute('transform'))
    if (!t) continue
    const cos = Math.cos(t.angle)
    const sin = Math.sin(t.angle)
    out.push({
      text,
      along: t.x * cos + t.y * sin,
      across: -t.x * sin + t.y * cos,
      size: t.size,
      angle: t.angle,
    })
  }
  return out
}

/** Whether a glyph belongs on the baseline a run is already sitting on. */
function sameLine(run: { angle: number; size: number; across: number }, g: Glyph): boolean {
  if (Math.abs(run.angle - g.angle) > 1e-6) return false
  if (Math.abs(run.size - g.size) > 1e-6) return false
  // Superscripts and subscripts have their own baseline, and separating them is correct: `10` and
  // `15` of a `10^15` tick are not one word
  return Math.abs(run.across - g.across) <= 0.05 * g.size
}

/**
 * Glyphs to runs.
 *
 * The converter emits every glyph as a direct child of `<svg>` with no grouping whatsoever — one
 * figure is a flat list where ticks, axis titles and legend entries run together as
 * `"110100Number of terms N1015…"` (§6.11). Document order within a run is exact, including the
 * spaces, which are glyphs of their own; all that has to be recovered is where one run ends.
 */
export function runsOf(svg: Element): GlyphRun[] {
  const runs: GlyphRun[] = []
  let current: GlyphRun | undefined

  for (const g of glyphsOf(svg)) {
    const gap = current ? g.along - current.to : 0
    if (current && sameLine(current, g) && gap >= 0 && gap <= RUN_BREAK * current.size) {
      current.text += g.text
      current.to = g.along
      current.glyphs++
      continue
    }
    if (current) runs.push(current)
    current = { text: g.text, angle: g.angle, size: g.size, from: g.along, to: g.along, across: g.across, glyphs: 1 }
  }
  if (current) runs.push(current)
  return runs
}

/** The figure's user-unit box, from `viewBox` or the width/height pair it usually matches. */
export function viewBoxOf(svg: Element): { x: number; y: number; w: number; h: number } | undefined {
  const raw = svg.getAttribute('viewBox')
  if (raw) {
    const [x, y, w, h] = raw.trim().split(/[\s,]+/).map(Number)
    if ([x, y, w, h].every(n => Number.isFinite(n)) && w! > 0 && h! > 0) return { x: x!, y: y!, w: w!, h: h! }
  }
  const w = Number.parseFloat(svg.getAttribute('width') ?? '')
  const h = Number.parseFloat(svg.getAttribute('height') ?? '')
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { x: 0, y: 0, w, h }
  return undefined
}

/**
 * The quarter turn the overlay will place a run at, or `undefined` when it is not near one.
 *
 * Only upright and the two quarter turns. Everything downstream describes a rotated label by its
 * axis-aligned bounding box plus an angle, and that only *is* the label's own box at a quarter
 * turn — at 30° the bounding box is much larger than the text, and rotating it would put the
 * overlay across the plot at the wrong size.
 *
 * **180° is excluded too**, even though its bounding box would be right. The overlay's geometry for
 * a rotated label swaps the two axes, which a half turn does not; accepting it would draw an
 * upside-down horizontal label as a tall narrow box (Codex pointed this out on #134). It does not
 * occur in the corpus, so there is nothing to gain by handling it and something to lose by
 * pretending to.
 *
 * **The result is snapped, not merely accepted.** The tolerance below accepts a run up to 1.8° off
 * the axis, and consumers of the angle downstream do not read it as a number — they ask whether it
 * is truthy. `linesToBoxes` refuses to merge a line that carries one, and `labelStyle` selects the
 * ±90° layout that swaps width for height and cqw for cqh. Passing a tolerated residual through
 * therefore drew a label a fraction of a degree off horizontal as a tall narrow strip (Codex on
 * #134). Returning the nearest quarter turn exactly means no consumer can see an angle that is
 * neither 0 nor ±90°. Real data reaches the tolerance: 17 runs in the corpus sit within 1e-4° of
 * horizontal without being exactly horizontal, two of them translatable, and 22 rotated ones sit
 * at -90.000002° rather than -90°.
 *
 * Measured over the whole sampled set (58028 glyphs, 284 glyph-bearing files): 90.279% upright,
 * 8.455% at -90°, 0.107% at +90°, and **1.160% at 42 other angles**, the commonest -30°. An earlier
 * seven-paper sample contained none of the last group and the survey wrongly concluded there were
 * only two angles (Codex caught that on #133). Those counts were once quoted as 55047 glyphs over
 * 253 files: the crawl logged 281 asset references but only 276 distinct paths, five files being
 * referenced twice within their paper and counted twice (`docs/RESEARCH.md` §6.11).
 */
function quarterTurn(angle: number): number | undefined {
  const quarters = angle / (Math.PI / 2)
  const nearest = Math.round(quarters)
  if (Math.abs(quarters - nearest) >= 0.02 || Math.abs(nearest) > 1) return undefined
  // Just below horizontal `Math.round` yields `-0`; normalising it away keeps the returned value
  // exactly one of 0, +π/2 and -π/2, which is the whole point of snapping
  return nearest === 0 ? 0 : nearest * (Math.PI / 2)
}

/**
 * A run's four corners in the figure's own coordinates, before normalising.
 *
 * The box is the text's own: `from`..`to` along the baseline plus one advance for the last glyph,
 * and `size` tall sitting above the baseline. For an upright run that is the familiar box; for a
 * rotated one it is rotated with the text, which is what keeps a vertical axis label from claiming
 * a wide horizontal strip of the plot.
 */
function cornersOf(run: GlyphRun): [number, number][] {
  const cos = Math.cos(run.angle)
  const sin = Math.sin(run.angle)
  // 最后一个字形自己的宽度没有记录，用一个名义宽度顶上。0.70 em 是量出来的：白框要盖住它译的
  // 那段原文字，0.55 em 时结尾是大写字母的标签会露出约 0.7% 图宽（`training cost C`），
  // 0.70 降到 0.09%（亚像素），再放大到 0.80 没有任何改善，只会让窄结尾的框多外扩
  const end = run.to + 0.7 * run.size
  const top = run.across - run.size * 0.78
  const bottom = run.across + run.size * 0.22
  const at = (along: number, across: number): [number, number] => [along * cos - across * sin, along * sin + across * cos]
  return [at(run.from, top), at(end, top), at(end, bottom), at(run.from, bottom)]
}

/**
 * Runs as `OcrLine`s in normalised coordinates, ready for `linesToBoxes`.
 *
 * `conf` is 1 because the text was read rather than recognised — there is nothing to be uncertain
 * about. `linesToBoxes` filters on confidence for the OCR path; here it never removes anything.
 */
export function linesOf(svg: Element): OcrLine[] {
  const box = viewBoxOf(svg)
  if (!box) return []
  const out: OcrLine[] = []
  for (const run of runsOf(svg)) {
    const angle = quarterTurn(run.angle)
    if (angle === undefined) continue
    // The corners keep the run's true angle: the box is then the text's own, and the axis-aligned
    // bounds taken downstream cover it whichever way the residual leans
    const quad = cornersOf(run).map(([x, y]) => [(x - box.x) / box.w, (y - box.y) / box.h] as [number, number])
    // An upright run carries no angle at all, exactly the shape the OCR backend produces
    out.push(angle === 0 ? { text: run.text, quad: quad as Quad, conf: 1 } : { text: run.text, quad: quad as Quad, conf: 1, angle })
  }
  return out
}
