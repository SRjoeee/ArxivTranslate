// The source peek on its own (issue #141): the panel, its dwell and where it goes. How it is driven
// from the pointer is covered with the rest of the controller in `highlight.test.ts`.
import { describe, expect, it } from 'vitest'
import { INJECTED_SELECTOR, isInjected } from '@/core/marks'
import { AT_ATTR, PEEK_DWELL_MS, createPeek, type PeekAnchor } from '@/core/renderer/peek'

const doc = () => new DOMParser().parseFromString('<html><body></body></html>', 'text/html')

/** Timers under test control: `setTimeout` queues, `fire` runs what is due. */
function timers(d: Document) {
  const view = d.defaultView as unknown as Record<string, unknown>
  const queue: { fn: () => void; delay: number; id: number }[] = []
  let next = 1
  view.setTimeout = (fn: () => void, delay: number) => { queue.push({ fn, delay, id: next }); return next++ }
  view.clearTimeout = (id: number) => { const at = queue.findIndex(t => t.id === id); if (at >= 0) queue.splice(at, 1) }
  return {
    delays: () => queue.map(t => t.delay),
    fire: () => { for (const t of queue.splice(0)) t.fn() },
  }
}

/** A range over one text node's whole content, as `rangesOf` would build for a sentence. */
function rangeOver(node: Node): Range {
  const r = node.ownerDocument!.createRange()
  r.selectNodeContents(node)
  return r
}

/** What the page sets its text in; the panel repeats it inline */
const TYPE = { font: '16px sans-serif', color: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)' }
const TYPED = ';font:16px sans-serif;color:rgb(0, 0, 0);background-color:rgb(255, 255, 255)'
/** A 1440×900 viewport with the article spanning 304–1136 (52rem centred) and a block inside it. */
const wide: PeekAnchor = { top: 400, bottom: 425, block: { left: 320, width: 800 }, articleRight: 1136, marginFree: true, viewport: { width: 1440, height: 900 }, type: TYPE }
/** 1100 wide: 134px beside the article, no room for a panel */
const narrow: PeekAnchor = { ...wide, block: { left: 150, width: 800 }, articleRight: 966, viewport: { width: 1100, height: 900 } }

const KEY = (root: Element, index = 0, shown: Element = root) => ({ root, index, shown })

describe('source peek (#141)', () => {
  it('shows the sentence only after the dwell, and counts the dwell per sentence', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="src">Hidden <em>original</em> sentence.</p>'
    const src = d.getElementById('src')!
    const peek = createPeek(d)
    let built = 0
    const ranges = () => { built++; return [rangeOver(src)] }

    peek.show(KEY(src), ranges, wide)
    expect(d.querySelector<HTMLElement>('.axt-peek')).toBeNull()
    expect(built).toBe(0) // nothing is cloned for a sentence the pointer merely passed
    expect(t.delays()).toEqual([PEEK_DWELL_MS])
    // The pointer wobbles within the sentence: the same key again does not restart the wait
    peek.show(KEY(src), ranges, wide)
    expect(t.delays()).toEqual([PEEK_DWELL_MS])

    t.fire()
    const panel = d.querySelector<HTMLElement>('.axt-peek')!
    expect(panel).not.toBeNull()
    expect(panel.parentElement).toBe(d.body)
    expect(panel.getAttribute('aria-hidden')).toBe('true')
    expect(panel.hasAttribute('inert')).toBe(true) // a cloned link must not be reachable by Tab
    expect(panel.textContent).toBe('Hidden original sentence.')
    expect(panel.querySelector('em')).not.toBeNull() // the DOM, not its text
    expect(built).toBe(1)
  })

  it('switches at once while open, and waits again after it closed', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p><p id="b">Two.</p>'
    const a = d.getElementById('a')!
    const b = d.getElementById('b')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], wide)
    t.fire()
    expect(d.querySelector<HTMLElement>('.axt-peek')!.textContent).toBe('One.')

    // Warm: the next sentence needs no second wait
    peek.show(KEY(b), () => [rangeOver(b)], wide)
    expect(t.delays()).toEqual([])
    expect(d.querySelector<HTMLElement>('.axt-peek')!.textContent).toBe('Two.')

    // Closed — a page scroll, say — and the dwell is cold again
    peek.hide()
    expect(d.querySelector<HTMLElement>('.axt-peek')!.hidden).toBe(true)
    expect(d.querySelector<HTMLElement>('.axt-peek')!.textContent).toBe('')
    peek.show(KEY(a), () => [rangeOver(a)], wide)
    expect(t.delays()).toEqual([PEEK_DWELL_MS])
    expect(d.querySelector<HTMLElement>('.axt-peek')!.hidden).toBe(true)
  })

  it('hiding during the dwell cancels it', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], wide)
    peek.hide()
    expect(t.delays()).toEqual([])
    t.fire()
    expect(d.querySelector<HTMLElement>('.axt-peek')).toBeNull()
  })

  it('clones carry no id, no data-axt-*, no injected node and no footnote', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="src" data-axt-id="b1">Text <math id="m1"><mi>x</mi></math> more'
      + '<span class="ltx_note" id="n1"><span class="ltx_note_mark">1</span><span class="ltx_note_content">footnote</span></span>'
      + ' end.<span class="axt-t" data-axt-for="b1">译文</span></p>'
    const src = d.getElementById('src')!
    const peek = createPeek(d)
    peek.show(KEY(src), () => [rangeOver(src)], wide)
    t.fire()
    const panel = d.querySelector<HTMLElement>('.axt-peek')!
    expect(panel.querySelector('math')).not.toBeNull() // the formula lives
    expect(panel.querySelectorAll('[id]')).toHaveLength(0)
    expect(panel.querySelectorAll('[data-axt-id], [data-axt-for]')).toHaveLength(0)
    expect(panel.querySelector(INJECTED_SELECTOR)).toBeNull()
    expect(panel.querySelector('.ltx_note')).toBeNull()
    expect(panel.textContent).toBe('Text x more end.')
    // The page itself is untouched
    expect(d.getElementById('m1')).not.toBeNull()
    expect(d.getElementById('n1')).not.toBeNull()
  })

  it('pieces are appended in order, so a cut around an injected node loses only that node', () => {
    // `rangesOf` cuts where one of our nodes sits between two runs of the sentence
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="src"><span id="x">before </span><span class="axt-t">译</span><span id="y">after.</span></p>'
    const src = d.getElementById('src')!
    const peek = createPeek(d)
    peek.show(KEY(src), () => [rangeOver(d.getElementById('x')!), rangeOver(d.getElementById('y')!)], wide)
    t.fire()
    expect(d.querySelector<HTMLElement>('.axt-peek')!.textContent).toBe('before after.')
  })

  it('goes in the margin when it fits, top-aligned to the sentence', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], wide)
    t.fire()
    const panel = d.querySelector<HTMLElement>('.axt-peek')!
    expect(panel.getAttribute(AT_ATTR)).toBe('margin')
    // 1440 − 1136 = 304 free, minus the gap on each side → 288 = 18rem exactly
    expect(panel.getAttribute('style')).toBe(`left:1144px;top:400px;width:288px;max-height:492px${TYPED}`)
  })

  it('in the margin, hangs from the sentence when little room is left below it', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], { ...wide, top: 850, bottom: 875 })
    t.fire()
    const panel = d.querySelector<HTMLElement>('.axt-peek')!
    expect(panel.getAttribute(AT_ATTR)).toBe('margin')
    expect(panel.getAttribute('style')).toBe(`left:1144px;bottom:25px;width:288px;max-height:867px${TYPED}`)
  })

  it('floats below the sentence when the margin is too narrow, as wide as the block', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], narrow)
    t.fire()
    const panel = d.querySelector<HTMLElement>('.axt-peek')!
    expect(panel.getAttribute(AT_ATTR)).toBe('below')
    expect(panel.getAttribute('style')).toBe(`left:150px;top:433px;width:800px;max-height:459px${TYPED}`)
  })

  it('floats above the sentence when there is no room below, anchored by its bottom edge', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], { ...narrow, top: 850, bottom: 875 })
    t.fire()
    const panel = d.querySelector<HTMLElement>('.axt-peek')!
    expect(panel.getAttribute(AT_ATTR)).toBe('above')
    // Never measured: `bottom` puts its lower edge 8px over the sentence whatever its height
    expect(panel.getAttribute('style')).toBe(`left:150px;bottom:58px;width:800px;max-height:834px${TYPED}`)
  })

  it('leaves the stylesheet fallbacks alone when the page reports no type', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], { ...wide, type: { font: '', color: '', background: '' } })
    t.fire()
    expect(d.querySelector<HTMLElement>('.axt-peek')!.getAttribute('style')).toBe('left:1144px;top:400px;width:288px;max-height:492px')
  })

  it('takes the roomier side when the default one is cramped', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    // 175px left below — fewer than ten lines — and 700 above: above
    peek.show(KEY(a), () => [rangeOver(a)], { ...narrow, top: 700, bottom: 725 })
    t.fire()
    expect(d.querySelector<HTMLElement>('.axt-peek')!.getAttribute(AT_ATTR)).toBe('above')
    expect(d.querySelector<HTMLElement>('.axt-peek')!.getAttribute('style')).toBe(`left:150px;bottom:208px;width:800px;max-height:684px${TYPED}`)
    // Cramped on both sides, more below: below
    peek.show(KEY(a, 1), () => [rangeOver(a)], { ...narrow, top: 100, bottom: 125, viewport: { width: 1100, height: 300 } })
    expect(d.querySelector<HTMLElement>('.axt-peek')!.getAttribute(AT_ATTR)).toBe('below')
    // In the margin the same choice is between top-aligned and hanging
    peek.show(KEY(a, 2), () => [rangeOver(a)], { ...wide, top: 700, bottom: 725 })
    expect(d.querySelector<HTMLElement>('.axt-peek')!.getAttribute('style')).toBe(`left:1144px;bottom:175px;width:288px;max-height:717px${TYPED}`)
  })

  it('stays out of a margin the page already uses', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], { ...wide, marginFree: false })
    t.fire()
    expect(d.querySelector<HTMLElement>('.axt-peek')!.getAttribute(AT_ATTR)).toBe('below')
  })

  it('marginFree: the panel\'s footprint against every margin aside\'s box', () => {
    const d = doc()
    d.body.innerHTML = '<span class="ltx_note" id="n1">1</span><span class="ltx_note" id="n2">2</span><span class="ltx_pubnotes" id="pub">p</span><p id="a">One.</p>'
    const rect = (el: Element, left: number, top: number, width: number, height: number) =>
      Object.assign(el, { getBoundingClientRect: () => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect })
    const peek = createPeek(d)
    const vp = { width: 1440, height: 900 }
    // Nothing in the gutter: 304px free beside the article, 288 for the panel
    expect(peek.marginFree(1136, 400, 425, vp)).toBe(true)
    // Too narrow a margin is never free
    expect(peek.marginFree(966, 400, 425, { width: 1100, height: 900 })).toBe(false)
    // A one-line note 500–530 in the gutter, well inside a top-aligned panel's column: taken
    rect(d.getElementById('n1')!, 1150, 500, 200, 30)
    expect(peek.marginFree(1136, 400, 425, vp)).toBe(false)
    // The same note is above a panel hanging from a sentence near the bottom? No — that panel
    // grows upward from 875 and reaches it
    expect(peek.marginFree(1136, 850, 875, vp)).toBe(false)
    // Below the sentence, though, a hanging panel never reaches it
    rect(d.getElementById('n1')!, 1150, 880, 200, 15)
    expect(peek.marginFree(1136, 850, 875, vp)).toBe(true)
    // In the article's own flow, not the gutter: no box in the column
    rect(d.getElementById('n1')!, 400, 500, 200, 30)
    expect(peek.marginFree(1136, 400, 425, vp)).toBe(true)
    // Collapsed (narrow window folds the notes away): no box at all
    rect(d.getElementById('n2')!, 1150, 500, 0, 0)
    expect(peek.marginFree(1136, 400, 425, vp)).toBe(true)
    // Publication notes count too
    rect(d.getElementById('pub')!, 1150, 420, 200, 60)
    expect(peek.marginFree(1136, 400, 425, vp)).toBe(false)
  })

  it('a dwell whose sentence is no longer current renders nothing', () => {
    // `clearSentenceHighlights()` from outside — setMode, applyStyle — finds no panel to remove
    // while the dwell is counting; the timer asks before rendering
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    let current = true
    const peek = createPeek(d, () => current)
    peek.show(KEY(a), () => [rangeOver(a)], wide)
    current = false
    t.fire()
    expect(d.querySelector('.axt-peek')).toBeNull()
  })

  it('rebuilds when the other side becomes the hidden one, or the hidden side is re-rendered', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">Original.</p><p id="b">译文。</p>'
    const a = d.getElementById('a')!
    const b = d.getElementById('b')!
    const peek = createPeek(d)
    peek.show(KEY(a, 0, a), () => [rangeOver(a)], wide)
    t.fire()
    expect(d.querySelector('.axt-peek')!.textContent).toBe('Original.')
    // Same sentence, the translation is now the hidden side: not a position-only update
    peek.show(KEY(a, 0, b), () => [rangeOver(b)], wide)
    expect(d.querySelector('.axt-peek')!.textContent).toBe('译文。')
  })

  it('rebuilds the clone after a mutation inside the element it shows, and only then', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">Original.</p><p id="z">Elsewhere.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    let built = 0
    const ranges = () => { built++; return [rangeOver(a)] }
    peek.show(KEY(a), ranges, wide)
    t.fire()
    expect(d.querySelector('.axt-peek')!.textContent).toBe('Original.')
    // A mutation somewhere else: the same key only moves the panel
    peek.touched(d.getElementById('z')!.firstChild!)
    peek.show(KEY(a), ranges, wide)
    expect(built).toBe(1)
    // In place, inside the shown element: the clone is rebuilt from what is there now
    a.firstChild!.textContent = 'Changed.'
    peek.touched(a.firstChild!)
    peek.show(KEY(a), ranges, wide)
    expect(built).toBe(2)
    expect(d.querySelector('.axt-peek')!.textContent).toBe('Changed.')
  })

  it('never asks for a negative height when a sentence fills the viewport', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], { ...narrow, top: 4, bottom: 896 })
    t.fire()
    expect(d.querySelector<HTMLElement>('.axt-peek')!.getAttribute('style')).toContain('max-height:0px')
  })

  it('has no margin tier without an article root', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], { ...wide, articleRight: undefined })
    t.fire()
    expect(d.querySelector<HTMLElement>('.axt-peek')!.getAttribute(AT_ATTR)).toBe('below')
  })

  it('re-showing the same sentence only moves the panel', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    let built = 0
    const ranges = () => { built++; return [rangeOver(a)] }
    peek.show(KEY(a), ranges, wide)
    t.fire()
    const before = d.querySelector<HTMLElement>('.axt-peek')!.firstChild
    peek.show(KEY(a), ranges, { ...wide, top: 500, bottom: 525 })
    expect(built).toBe(1)
    expect(d.querySelector<HTMLElement>('.axt-peek')!.firstChild).toBe(before)
    expect(d.querySelector<HTMLElement>('.axt-peek')!.getAttribute('style')).toContain('top:500px')
  })

  it('starts cold again after the panel was removed from outside', () => {
    // `clearSentenceHighlights` (setMode, applyStyle) takes the panel away without telling the peek
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p><p id="b">Two.</p>'
    const a = d.getElementById('a')!
    const b = d.getElementById('b')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], wide)
    t.fire()
    d.querySelector<HTMLElement>('.axt-peek')!.remove()
    peek.show(KEY(b), () => [rangeOver(b)], wide)
    expect(d.querySelector<HTMLElement>('.axt-peek')).toBeNull() // not warm: the dwell runs again
    expect(t.delays()).toEqual([PEEK_DWELL_MS])
    t.fire()
    expect(d.querySelector<HTMLElement>('.axt-peek')!.textContent).toBe('Two.')
  })

  it('is one of ours: swept by the injected selector, and recognised as such', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], wide)
    t.fire()
    const panel = d.querySelector<HTMLElement>('.axt-peek')!
    expect(isInjected(panel)).toBe(true)
    expect(d.querySelector(INJECTED_SELECTOR)).toBe(panel)
    expect(peek.contains(panel.firstChild!)).toBe(true)
    expect(peek.contains(a)).toBe(false)
    peek.remove()
    expect(d.querySelector<HTMLElement>('.axt-peek')).toBeNull()
  })
})
