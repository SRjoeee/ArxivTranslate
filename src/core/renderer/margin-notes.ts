// Margin notes stack down the right gutter (DESIGN §7.2).
//
// arXiv floats footnotes to the page's outer edge, with `float: inline-end` + `clear: both` stacking them one under
// the other; that works because the whole page's floats share one formatting context and see each other. In side
// mode every block is a grid item, that is its own formatting context: the float is contained by the block, and
// **as tall as the box, so tall the grid row** (#154 measured one long footnote pushing a grid row to 1321px, both
// columns empty). So the style sheet zeroes the box's height (`height: 0; overflow: visible`, what ar5iv itself
// writes for footnotes inside list items).
//
// That one number decides both “does it stretch the grid row” and “do later floats make way for it”, and CSS has
// no second knob: zeroed, they no longer avoid one another, and several footnotes in one block stack at the line
// pitch (the owner's feedback of 2026-09-11 on 2509.10652v3: six URL footnotes 32px apart, each 50px tall); the
// version that gave the height back “when a block has sibling footnotes” pushed a grid row on 2609.10326v1 from
// 162px to 1442px the same day, and the blank space was back (the owner's feedback that day).
//
// So the height is always zero (grid rows untouched) and **the position is measured here and written**: in document
// order, a note that would overlap the previous one is pushed down with `transform: translateY()`. A transform takes
// no part in layout — however far it pushes, nothing grows and no text reflows; only the painted box moves — and the
// result matches arXiv's own float stacking.
//
// Reading and writing are two functions, so the tidy layer (renderer/prep.ts) can put the read before every write
// of the pass (§10).
import { T_CLASS } from '@/core/marks'
import { NOTE } from '@/core/rules/latexml'

/** The gap between two margin notes: ar5iv gives `.ltx_note_outer` exactly 2rem of padding-bottom; the same rhythm */
const GAP_REM = 2

/** One measured margin note: where it falls naturally, how tall it paints, and whether it is the copy we may move */
export interface NoteBox {
  /** Its painted top edge without this code's push (viewport coordinates; only differences are used within a pass, never converted to document coordinates) */
  top: number
  /** The painted height. The box is zeroed by the style sheet, so the content inside is what is measured */
  height: number
  /** The copy in the translation is our own node and may be styled; the original's is not (§7.1) and is only an obstacle to steer round */
  ours: boolean
}

export interface MarginNotePlan {
  shifts: Array<{ outer: HTMLElement; shift: number }>
}

/** The offset already written to each margin note. Measuring must subtract it to get the “natural position” */
const applied = new WeakMap<HTMLElement, number>()

/**
 * Pure arithmetic: a downward offset for every margin note in document order, none overlapping another.
 * The original's own note cannot be moved (`ours: false`); it stays where it is and only counts as an obstacle
 * the later ones make way for.
 */
export function stackShifts(boxes: readonly NoteBox[], gap: number): number[] {
  // The immovable ones are **obstacles without order**: a long copy would paint over the next block's original, and
  // the original may not move (§7.1), so the copy has to keep making way downwards (Codex on #163, over two rounds:
  // first the floor being pulled back up, then looking only at the notes before). These obstacles disappear as the
  // later blocks get translated, and the room they gave up is taken back next pass, so the extra way made is only a
  // transitional state
  const blocks = boxes.filter(b => !b.ours).map(b => ({ top: b.top, bottom: b.top + b.height }))
  const out: number[] = []
  let floor = Number.NEGATIVE_INFINITY
  for (const box of boxes) {
    let top = box.ours ? Math.max(box.top, floor) : box.top
    if (box.ours) {
      // Every yield only increases top and the obstacles are finite, so this converges
      for (let moved = true; moved;) {
        moved = false
        for (const b of blocks) {
          if (top < b.bottom + gap && b.top < top + box.height + gap) {
            top = b.bottom + gap
            moved = true
          }
        }
      }
    }
    out.push(top - box.top)
    // The floor only moves down, never back: an immovable original that naturally falls above the current floor would,
    // by plain assignment, **pull the floor back up**, and the next copy would then avoid only this original and land
    // again on the copy pushed down before it
    floor = Math.max(floor, top + box.height + gap)
  }
  return out
}

/** The vertical extent a margin note really paints. The box is `height: 0`, measuring it says nothing; the content inside is measured */
function paintedSpan(outer: Element): { top: number; height: number } | null {
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const child of Array.from(outer.children)) {
    const r = child.getBoundingClientRect()
    // A collapsed one (the site sets the whole box display:none below 96rem) and an original we hid are both 0×0
    if (r.width === 0 && r.height === 0) continue
    top = Math.min(top, r.top)
    bottom = Math.max(bottom, r.bottom)
  }
  return bottom > top ? { top, height: bottom - top } : null
}

/** Read only: measure how far each margin note of this pass has to be pushed down. The whole paper at once — each push depends on every note before it */
export function planMarginNotes(root: Document | Element): MarginNotePlan {
  const doc = root.nodeType === 9 ? (root as Document) : (root as Element).ownerDocument
  const view = doc?.defaultView
  if (!doc || !view) return { shifts: [] }
  const rem = Number.parseFloat(view.getComputedStyle(doc.documentElement).fontSize) || 16
  const outers: HTMLElement[] = []
  const boxes: NoteBox[] = []
  for (const outer of Array.from(doc.querySelectorAll<HTMLElement>(NOTE.marginOuter))) {
    const span = paintedSpan(outer)
    if (!span) continue
    outers.push(outer)
    boxes.push({ top: span.top - (applied.get(outer) ?? 0), height: span.height, ours: !!outer.closest(`.${T_CLASS}`) })
  }
  const shifts = stackShifts(boxes, GAP_REM * rem)
  return { shifts: outers.map((outer, i) => ({ outer, shift: shifts[i]! })).filter((_, i) => boxes[i]!.ours) }
}

/** Write only: write the offsets down; returns how many notes really moved this pass (0 once settled) */
export function applyMarginNotes(plan: MarginNotePlan): number {
  let moved = 0
  for (const { outer, shift } of plan.shifts) {
    if (Math.abs((applied.get(outer) ?? 0) - shift) < 0.5) continue
    applied.set(outer, shift)
    outer.style.transform = shift > 0.5 ? `translateY(${Math.round(shift)}px)` : ''
    moved += 1
  }
  return moved
}

/** Erase the offsets written (on leaving side mode: in the other modes the floats avoid one another by their own height) */
export function clearMarginNotes(root: Document | Element): void {
  for (const outer of Array.from(root.querySelectorAll<HTMLElement>(NOTE.marginOuter))) {
    if (!outer.style.transform) continue
    applied.set(outer, 0)
    outer.style.removeProperty('transform')
  }
}
