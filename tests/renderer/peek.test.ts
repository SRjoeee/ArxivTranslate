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

/** A 1440×900 viewport with the article spanning 304–1136 (52rem centred) and a block inside it. */
const wide: PeekAnchor = { top: 400, bottom: 425, block: { left: 320, width: 800 }, articleRight: 1136, viewport: { width: 1440, height: 900 } }
/** 1100 wide: 134px beside the article, no room for a panel */
const narrow: PeekAnchor = { ...wide, block: { left: 150, width: 800 }, articleRight: 966, viewport: { width: 1100, height: 900 } }

const KEY = (root: Element, index = 0) => ({ root, index })

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
    expect(d.querySelector('.axt-peek')).toBeNull()
    expect(built).toBe(0) // nothing is cloned for a sentence the pointer merely passed
    expect(t.delays()).toEqual([PEEK_DWELL_MS])
    // The pointer wobbles within the sentence: the same key again does not restart the wait
    peek.show(KEY(src), ranges, wide)
    expect(t.delays()).toEqual([PEEK_DWELL_MS])

    t.fire()
    const panel = d.querySelector('.axt-peek')!
    expect(panel).not.toBeNull()
    expect(panel.parentElement).toBe(d.body)
    expect(panel.getAttribute('aria-hidden')).toBe('true')
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
    expect(d.querySelector('.axt-peek')!.textContent).toBe('One.')

    // Warm: the next sentence needs no second wait
    peek.show(KEY(b), () => [rangeOver(b)], wide)
    expect(t.delays()).toEqual([])
    expect(d.querySelector('.axt-peek')!.textContent).toBe('Two.')

    // Closed — a page scroll, say — and the dwell is cold again
    peek.hide()
    expect(d.querySelector('.axt-peek')!.hidden).toBe(true)
    expect(d.querySelector('.axt-peek')!.textContent).toBe('')
    peek.show(KEY(a), () => [rangeOver(a)], wide)
    expect(t.delays()).toEqual([PEEK_DWELL_MS])
    expect(d.querySelector('.axt-peek')!.hidden).toBe(true)
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
    expect(d.querySelector('.axt-peek')).toBeNull()
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
    const panel = d.querySelector('.axt-peek')!
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
    expect(d.querySelector('.axt-peek')!.textContent).toBe('before after.')
  })

  it('goes in the margin when it fits, top-aligned to the sentence', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], wide)
    t.fire()
    const panel = d.querySelector('.axt-peek')!
    expect(panel.getAttribute(AT_ATTR)).toBe('margin')
    // 1440 − 1136 = 304 free, minus the gap on each side → 288 = 18rem exactly
    expect(panel.getAttribute('style')).toBe('left:1144px;top:400px;width:288px;max-height:492px')
  })

  it('in the margin, hangs from the sentence when little room is left below it', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], { ...wide, top: 850, bottom: 875 })
    t.fire()
    const panel = d.querySelector('.axt-peek')!
    expect(panel.getAttribute(AT_ATTR)).toBe('margin')
    expect(panel.getAttribute('style')).toBe('left:1144px;bottom:25px;width:288px;max-height:867px')
  })

  it('floats below the sentence when the margin is too narrow, as wide as the block', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], narrow)
    t.fire()
    const panel = d.querySelector('.axt-peek')!
    expect(panel.getAttribute(AT_ATTR)).toBe('below')
    expect(panel.getAttribute('style')).toBe('left:150px;top:433px;width:800px;max-height:459px')
  })

  it('floats above the sentence when there is no room below, anchored by its bottom edge', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], { ...narrow, top: 850, bottom: 875 })
    t.fire()
    const panel = d.querySelector('.axt-peek')!
    expect(panel.getAttribute(AT_ATTR)).toBe('above')
    // Never measured: `bottom` puts its lower edge 8px over the sentence whatever its height
    expect(panel.getAttribute('style')).toBe('left:150px;bottom:58px;width:800px;max-height:834px')
  })

  it('has no margin tier without an article root', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], { ...wide, articleRight: undefined })
    t.fire()
    expect(d.querySelector('.axt-peek')!.getAttribute(AT_ATTR)).toBe('below')
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
    const before = d.querySelector('.axt-peek')!.firstChild
    peek.show(KEY(a), ranges, { ...wide, top: 500, bottom: 525 })
    expect(built).toBe(1)
    expect(d.querySelector('.axt-peek')!.firstChild).toBe(before)
    expect(d.querySelector('.axt-peek')!.getAttribute('style')).toContain('top:500px')
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
    d.querySelector('.axt-peek')!.remove()
    peek.show(KEY(b), () => [rangeOver(b)], wide)
    expect(d.querySelector('.axt-peek')).toBeNull() // not warm: the dwell runs again
    expect(t.delays()).toEqual([PEEK_DWELL_MS])
    t.fire()
    expect(d.querySelector('.axt-peek')!.textContent).toBe('Two.')
  })

  it('is one of ours: swept by the injected selector, and recognised as such', () => {
    const d = doc()
    const t = timers(d)
    d.body.innerHTML = '<p id="a">One.</p>'
    const a = d.getElementById('a')!
    const peek = createPeek(d)
    peek.show(KEY(a), () => [rangeOver(a)], wide)
    t.fire()
    const panel = d.querySelector('.axt-peek')!
    expect(isInjected(panel)).toBe(true)
    expect(d.querySelector(INJECTED_SELECTOR)).toBe(panel)
    expect(peek.contains(panel.firstChild!)).toBe(true)
    expect(peek.contains(a)).toBe(false)
    peek.remove()
    expect(d.querySelector('.axt-peek')).toBeNull()
  })
})
