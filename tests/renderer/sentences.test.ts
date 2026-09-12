import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { nodeOffsetAt, rehydrate, serialize, wireOffsetAt } from '@/core/protector'
import { SPLIT_CLASS } from '@/core/renderer/attrs'
import { registerSentences, sentenceAt, sentenceMapAt, sentenceMapOf } from '@/core/renderer/sentences'
import { splitFigures } from '@/core/renderer/split-figures'
import { docOf } from './helpers'
import { splitSentences } from '@/core/sentences'
import { verifyAlignment } from '@/providers/alignment'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')
const doc = () => new DOMParser().parseFromString('<html><body></body></html>', 'text/html')

/** Puts a block on a page with its translation beside it, exactly as `renderText` does. */
function render(html: string, fmt: 'tags' | 'markers' = 'tags') {
  const d = doc()
  d.body.innerHTML = html
  const source = d.body.firstElementChild!
  const block = serialize(source, fmt)
  const fragment = rehydrate(block.text, block, d)
  const target = d.createElement(source.tagName)
  target.append(fragment)
  source.after(target)
  return { d, source, target, block, spans: fragment.offsets }
}

/** 一张拆过图的插图：原文图注、被藏起来的译文、屏幕上那份副本 */
function splitCaption() {
  const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
    + '<figcaption class="ltx_caption" id="F1.cap">Figure 1: One. Two.</figcaption></figure>')
  const source = d.querySelector('figcaption')!
  const block = serialize(source, 'tags')
  const fragment = rehydrate(block.text, block, d)
  const target = d.createElement('figcaption')
  target.className = 'axt-t'
  target.setAttribute('data-axt-for', 'F1.cap')
  target.append(fragment)
  source.after(target)
  const lengths = splitSentences(block.text)
  registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
  splitFigures(d)
  const copy = d.querySelector(`.${SPLIT_CLASS} figcaption`)!
  Object.assign(target, { checkVisibility: () => false })
  Object.assign(copy, { checkVisibility: () => true })
  return { d, source, target, copy }
}

describe('sentence registry (#105)', () => {
  it('finds the block from a node on either side, and only when it was registered', () => {
    const { source, target, block, spans } = render('<p class="ltx_p">One. Two.</p>')
    const lengths = splitSentences(block.text)
    expect(sentenceMapAt(source.firstChild!)).toBeUndefined()

    registerSentences(source, target, block.offsets, spans, { source: lengths, target: lengths })
    expect(sentenceMapAt(source.firstChild!)?.side).toBe('source')
    expect(sentenceMapAt(target.firstChild!)?.side).toBe('target')
    expect(sentenceMapAt(source)?.map.pairs.length).toBe(lengths.length)
  })

  it('side 模式拆图之后，高亮跟着屏幕上那份走（#139）', () => {
    // `splitFigures` 把整张图连图注一起克隆到右栏，**读者看到的是克隆件**，而原件那份译文被藏起来了。
    // 只登记原件的话，悬停图注时译文侧算出来的矩形是空的——用户 2026-09-10 在 2609.04987v1 上报的
    // 拆图只在翻译根里扫，所以页面要有 `article.ltx_document`
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1: One. Two.</figcaption></figure>')
    const source = d.querySelector('figcaption')!
    const block = serialize(source, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('figcaption')
    // `renderText` 打的那两个标记：拆图按 `.axt-t` 找译文，没有它这张图根本不会被拆
    target.className = 'axt-t'
    target.setAttribute('data-axt-for', 'F1.cap')
    target.append(fragment)
    source.after(target)
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })

    expect(splitFigures(d)).toBe(1)
    const clone = d.querySelector(`.${SPLIT_CLASS}`)!
    const copy = clone.querySelector('figcaption')!
    expect(copy.textContent).toBe(target.textContent)

    // 悬停克隆件里的图注：解析得到同一个块，而且认得出这是译文那一侧
    const inCopy = sentenceMapAt(copy.firstChild!)
    expect(inCopy?.side).toBe('target')
    expect(inCopy?.map.pairs.length).toBe(lengths.length)
    // 悬停原文时，译文那侧指向的是**克隆件**——原件那份在 side 模式下没有盒子
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(copy)
    // span 换成了克隆里的节点，不是原件的
    const nodes = new Set(sentenceMapOf(copy)!.target.spans.map(s => s.node))
    expect([...nodes].every(n => copy.contains(n))).toBe(true)
    expect([...nodes].some(n => target.contains(n))).toBe(false)
  })

  it('切回 stack 时副本被藏起来，高亮回落到原件那份（#139）', () => {
    // **切模式不会删掉副本**，只是用 CSS 把一边藏起来（stack 藏副本、only 藏原件）。
    // 所以判据是「谁在屏幕上」而不是「谁还在文档里」——后者两边都成立，高亮会画在看不见的那份上
    // 拆图只在翻译根里扫，所以页面要有 `article.ltx_document`
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1: One. Two.</figcaption></figure>')
    const source = d.querySelector('figcaption')!
    const block = serialize(source, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('figcaption')
    // `renderText` 打的那两个标记：拆图按 `.axt-t` 找译文，没有它这张图根本不会被拆
    target.className = 'axt-t'
    target.setAttribute('data-axt-for', 'F1.cap')
    target.append(fragment)
    source.after(target)
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
    splitFigures(d)
    const copy = d.querySelector(`.${SPLIT_CLASS} figcaption`)!
    // side：两边都在屏幕上，取副本（右栏那份就是它）
    for (const el of [target, copy]) Object.assign(el, { checkVisibility: () => true })
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(copy)

    // stack：副本被 CSS 藏了，但**还在文档里**——回落到原件那份
    Object.assign(copy, { checkVisibility: () => false })
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(target)
  })

  it('拆图里按单元格登记的表格也跟着镜像（#148）', () => {
    // 表格的句子是按**单元格**登记的（`renderTable` 回报「原格 → 克隆格」），格子在 `.axt-t` 表格
    // 里面。只镜像 `.axt-t` 的话，插图里带表格时那些格子在克隆件里仍然没登记（Codex 在 #148 指出）
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1.</figcaption>'
      + '<div class="axt-t" data-axt-for="F1.cap"><table><tbody><tr>'
      + '<td class="ltx_td" id="F1.c1">One. Two.</td></tr></tbody></table></div></figure>')
    // 「格子」这一层：源与译各一个单元格，按格子登记，正是 renderTable 的做法
    const cell = d.getElementById('F1.c1')!
    const block = serialize(cell, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('td')
    target.append(fragment)
    cell.after(target)
    const lengths = splitSentences(block.text)
    registerSentences(cell, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })

    expect(splitFigures(d)).toBe(1)
    const copy = d.querySelector(`.${SPLIT_CLASS}`)!.querySelectorAll('td')[1]!
    for (const el of [target, copy]) Object.assign(el, { checkVisibility: () => true })
    // 悬停克隆件里的那个格子：解析得到同一个块
    expect(sentenceMapAt(copy.firstChild!)?.side).toBe('target')
    // 悬停原文格子：译文那侧指向克隆里的格子
    expect(sentenceMapAt(cell.firstChild!)?.map.target.root).toBe(copy)
  })

  it('重新翻一遍之后，还挂着的副本用的是这一版的句边界（#148）', () => {
    // 译文正文没变时 `translationKey` 不变，副本就不会被重建——它记的还是上一轮的句边界，
    // 而 side 模式下屏幕上正是它。正文一样时 span 仍然对得上，换掉句边界即可（Codex 在 #148 指出）
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1: One. Two.</figcaption></figure>')
    const source = d.querySelector('figcaption')!
    const block = serialize(source, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('figcaption')
    target.className = 'axt-t'
    target.setAttribute('data-axt-for', 'F1.cap')
    target.append(fragment)
    source.after(target)
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
    splitFigures(d)
    const copy = d.querySelector(`.${SPLIT_CLASS} figcaption`)!
    // side 模式的样子：原件那份译文被藏起来，屏幕上是副本
    Object.assign(target, { checkVisibility: () => false })
    Object.assign(copy, { checkVisibility: () => true })
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(copy)
    expect(sentenceMapAt(source.firstChild!)?.map.pairs).toHaveLength(lengths.length)

    // 同一段正文重翻一遍，这次只有一句
    const one = [block.text.length]
    registerSentences(source, target, block.offsets, fragment.offsets, { source: one, target: one })
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(copy)
    expect(sentenceMapAt(source.firstChild!)?.map.pairs).toHaveLength(1)

    // 这一轮完全没有对齐：副本记的那份也不能再用
    registerSentences(source, target, block.offsets, fragment.offsets, undefined)
    expect(sentenceMapAt(source.firstChild!)).toBeUndefined()
  })

  it('这一轮没有对齐时，副本自己那份记录也要作废（#148）', () => {
    // 光删「原文 → 译文」的索引不够：副本自己也是记录表的键，指针直接落在副本上照样查得到
    const { source, target, copy } = splitCaption()
    expect(sentenceMapAt(copy.firstChild!)).toBeDefined()

    const block = serialize(source, 'tags')
    registerSentences(source, target, block.offsets, undefined, undefined)
    expect(sentenceMapAt(copy.firstChild!)).toBeUndefined()
    expect(sentenceMapAt(source.firstChild!)).toBeUndefined()
  })

  it('从「没有对齐」变成「有对齐」时，留着的副本会被重建并镜像（#148）', () => {
    // 拆图按译文正文的签名决定要不要重建。正文没变、登记从无到有时，副本原样留下就永远不会被
    // 镜像——悬停原文落到藏起来的原件上，悬停副本什么也查不到
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1: One. Two.</figcaption></figure>')
    const source = d.querySelector('figcaption')!
    const block = serialize(source, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('figcaption')
    target.className = 'axt-t'
    target.setAttribute('data-axt-for', 'F1.cap')
    target.append(fragment)
    source.after(target)

    // 第一轮：没有对齐（谷歌 / LLM 的块就是这样）
    registerSentences(source, target, block.offsets, fragment.offsets, undefined)
    expect(splitFigures(d)).toBe(1)
    const first = d.querySelector(`.${SPLIT_CLASS} figcaption`)!
    expect(sentenceMapAt(first.firstChild!)).toBeUndefined()

    // 第二轮：同样的正文，这次有对齐了——副本必须重建并登记
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
    expect(splitFigures(d)).toBe(1)
    const rebuilt = d.querySelector(`.${SPLIT_CLASS} figcaption`)!
    Object.assign(target, { checkVisibility: () => false })
    Object.assign(rebuilt, { checkVisibility: () => true })
    expect(sentenceMapAt(rebuilt.firstChild!)?.side).toBe('target')
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(rebuilt)
  })

  it('表格从「没有对齐」变成「有对齐」时，签名要走进单元格，副本才会重建（#148）', () => {
    // 表格是唯一把句子登记在**后代**上的译文：`renderTable` 按单元格回报「原格 → 克隆格」，
    // `.axt-t` 表格本身从来没被登记过。签名只问表格就永远是空的，这种正文不变的转换看不见，
    // 副本原样留下、格子一格也没被镜像（Codex 在 #148 指出）。
    // 结构照 `renderTable`：整张 `.ltx_tabular` 克隆一份带 .axt-t，格子在克隆里
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1.</figcaption>'
      + '<figcaption class="ltx_caption axt-t" data-axt-for="F1.cap">图 1。</figcaption>'
      + '<table class="ltx_tabular" id="F1.tab" data-axt-id="F1.tab"><tbody><tr>'
      + '<td class="ltx_td">One. Two.</td></tr></tbody></table></figure>')
    const table = d.getElementById('F1.tab')!
    const cell = table.querySelector('td')!
    const clone = table.cloneNode(true) as Element
    clone.removeAttribute('id')
    clone.removeAttribute('data-axt-id')
    clone.classList.add('axt-t')
    clone.setAttribute('data-axt-for', 'F1.tab')
    table.after(clone)
    const target = clone.querySelector('td')!
    const block = serialize(cell, 'tags')
    const fragment = rehydrate(block.text, block, d)
    target.textContent = ''
    target.append(fragment)

    // 第一轮：没有对齐
    registerSentences(cell, target, block.offsets, fragment.offsets, undefined)
    expect(splitFigures(d)).toBe(1)
    const first = d.querySelector(`.${SPLIT_CLASS} td`)!
    expect(sentenceMapAt(first.firstChild!)).toBeUndefined()

    // 第二轮：同样的正文，这次有对齐了——副本必须重建，格子在副本里登记好
    const lengths = splitSentences(block.text)
    registerSentences(cell, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
    expect(splitFigures(d)).toBe(1)
    const rebuilt = d.querySelector(`.${SPLIT_CLASS} td`)!
    expect(rebuilt).not.toBe(first)
    Object.assign(target, { checkVisibility: () => false })
    Object.assign(rebuilt, { checkVisibility: () => true })
    expect(sentenceMapAt(rebuilt.firstChild!)?.side).toBe('target')
    expect(sentenceMapAt(cell.firstChild!)?.map.target.root).toBe(rebuilt)
  })

  it('registers nothing without an alignment, so those blocks simply do not highlight', () => {
    // Every Google and LLM block today. A guessed pairing would light up the wrong sentence.
    const { source, target, block, spans } = render('<p class="ltx_p">One. Two.</p>')
    registerSentences(source, target, block.offsets, spans, undefined)
    expect(sentenceMapAt(source.firstChild!)).toBeUndefined()
  })

  it('registers nothing when the translation side has no offsets', () => {
    // The runs fallback joins its own fragment and cannot report wire positions.
    const { source, target, block } = render('<p class="ltx_p">One. Two.</p>')
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, undefined, { source: lengths, target: lengths })
    expect(sentenceMapAt(source.firstChild!)).toBeUndefined()
  })

  it('finds the block from a text node however deep the formula is', () => {
    // The walk used to stop after twelve levels. Text nodes in the fixtures go to sixteen — a
    // `msqrt/msub/mi` in 2401.00596 — and twelve reaches only 99.824% of the 86409 of them. Deep
    // MathML nests without limit, so the walk goes to the root (Codex on #130).
    const d = doc()
    d.body.innerHTML = '<p class="ltx_p">One. Two.</p>'
    const source = d.body.firstElementChild!
    let deepest: Element = source
    for (let i = 0; i < 20; i++) {
      const wrap = d.createElement('span')
      deepest.append(wrap)
      deepest = wrap
    }
    const leaf = d.createTextNode('x')
    deepest.append(leaf)

    const block = serialize(source, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('p')
    target.append(fragment)
    source.after(target)
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })

    expect(sentenceMapAt(leaf)?.side).toBe('source')
  })

  // The leak this registry was restructured to avoid — an entry keyed by the original element,
  // which `restore()` leaves in the document, holding the whole detached translation — cannot be
  // tested here. happy-dom never releases a detached node: a control run with `--expose-gc` showed
  // a plain object collected and a detached `<p>` that nothing referenced still alive after five
  // collections, so a WeakRef assertion fails whichever way the registry is written and proves
  // nothing. `tests/e2e/extension.mjs` checks it in a real browser instead, where restoring a
  // translated page must let its translation nodes go.

  it('sentenceAt agrees with a linear scan at every offset', () => {
    const pairs = [0, 3, 3, 1, 12, 5].reduce<{ at: number; out: { index: number; source: { from: number; to: number }; target: { from: number; to: number } }[] }>(
      (acc, len) => {
        if (len > 0) {
          acc.out.push({ index: acc.out.length, source: { from: acc.at, to: acc.at + len }, target: { from: acc.at, to: acc.at + len } })
          acc.at += len
        }
        return acc
      },
      { at: 0, out: [] },
    ).out
    const total = pairs[pairs.length - 1]!.source.to
    for (let i = -2; i <= total + 2; i++) {
      const linear = pairs.find(p => i >= p.source.from && i < p.source.to)
      expect([i, sentenceAt(pairs, 'source', i)]).toEqual([i, linear])
    }
  })
})

describe('sentence lookup round trip (#105)', () => {
  /**
   * The property the hover highlight rests on: **the sentence found under the pointer must be the
   * one whose highlight covers the character the pointer is on.**
   *
   * `caretPositionFromPoint` hands the renderer a `(node, offset)`; `wireOffsetAt` turns that into
   * a wire offset, `sentenceAt` picks the sentence, and `rangesOf` builds that sentence's ranges
   * from `nodeOffsetAt`. So for every character of every text run, the sentence chosen for it has
   * to have boundaries that bracket it.
   *
   * Checked through `nodeOffsetAt` rather than by reading the ranges back, because happy-dom's
   * `Range` cannot be inspected — `toString()` is empty for every range and `startOffset` does not
   * return what was set. `tests/protector/offsets.test.ts` works around it by recording the
   * boundary calls; here the boundaries are what is being asserted, so they are compared directly.
   * The ranges themselves were verified in a real browser on #123 (656/656 intervals).
   *
   * Run over real fixture blocks in both wire formats, with a block's own text standing in for its
   * translation: that yields a genuine alignment (the same partition on both sides) with no engine,
   * and exercises exactly the path the renderer will.
   */
  it('the sentence found for a character has boundaries that cover it, across fixtures', () => {
    // Violations are collected rather than asserted per character: an `expect` per character means
    // over a million assertion objects, which costs seven times what the work itself does (906ms of
    // real work, measured). Reporting them together also shows how widespread a break is instead of
    // stopping at the first one.
    const violations: string[] = []
    let chars = 0
    let blocks = 0
    for (const f of readdirSync(FIXTURE_DIR).filter(n => n.endsWith('.html')).slice(0, 3)) {
      const d = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      for (const b of extract(d)) {
        if (b.kind !== 'text') continue
        for (const fmt of ['tags', 'markers'] as const) {
          const block = serialize(b.el, fmt)
          const lengths = splitSentences(block.text, fmt)
          if (lengths.length < 2) continue
          const alignment = verifyAlignment({ source: lengths, target: lengths }, block.text, block.text)
          expect([f, b.id, fmt, alignment !== undefined]).toEqual([f, b.id, fmt, true])

          const frag = rehydrate(block.text, block, d)
          const target = d.createElement(b.el.tagName)
          target.append(frag)
          registerSentences(b.el, target, block.offsets, frag.offsets, alignment!)
          const map = sentenceMapOf(b.el)!
          blocks++

          for (const side of ['source', 'target'] as const) {
            const { spans, index } = map[side]
            for (const span of spans) {
              if (span.kind !== 'text') continue
              // Walked once, carrying the next boundary forward, rather than asking twice per
              // character: this runs over every character of every fixture block.
              let next = wireOffsetAt(index, span.node, 0)
              for (let k = 0; k < span.node.data.length; k++) {
                const wire = next
                next = wireOffsetAt(index, span.node, k + 1)
                // A character the tracker collapsed away occupies no wire position and so belongs
                // to no sentence — the run `"). \n"` goes out as `"). "`. It renders as nothing, so
                // no pointer can land on it, and which sentence owns it is not a question with an
                // answer.
                if (wire === next) continue
                const where = `${f} ${b.id} ${fmt} ${side} k=${k}`
                if (wire === undefined) {
                  violations.push(`${where}: no wire offset`)
                  continue
                }
                const sentence = sentenceAt(map.pairs, side, wire)
                if (!sentence) {
                  violations.push(`${where}: wire ${wire} is in no sentence`)
                  continue
                }
                const { from, to } = sentence[side]
                // `nodeOffsetAt` clamps to the span, which is what `rangesOf` relies on when a
                // sentence starts or ends outside this run
                if (!(nodeOffsetAt(span, from) <= k && k < nodeOffsetAt(span, to))) {
                  violations.push(`${where}: sentence ${sentence.index} covers [${nodeOffsetAt(span, from)},${nodeOffsetAt(span, to)}) in this run`)
                }
                chars++
              }
            }
          }
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([])
    expect([violations.length, blocks > 900, chars > 500_000]).toEqual([0, true, true])
  })
})
