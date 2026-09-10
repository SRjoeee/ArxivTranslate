import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
// runs 路径的 markers 覆盖在 runs.test.ts：在这里对 12 篇跑一遍只是「不抛异常」，不挂断言，
// 却让这个文件与 tags 那个并行时把最重的 fixture 顶到 10 s 预算线上（CI 实测 10223 ms）
import { rehydrate, serialize, tokenize, validate } from '@/core/protector'
import { LABEL_FORMATTING } from '@/core/rules/latexml'
import { sameModuloWhitespace } from './helpers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

// markers 格式（#104）。单独成文件：与 tags 那组同处一个 worker 会累积 26 篇 1.8 MB 文档，实测撑爆 4 GB 堆
// markers 格式（#104）：纯文本线，只有 void，成对占位符拍平。等价关系因此比 tags 弱一档——
// 内联包装元素（<em> 之类）会消失，所以不能拿 innerHTML 比，比的是「文字一字不差、受保护节点原样且顺序不变」。
describe('fixture 往返（markers）', () => {
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  for (const f of files) {
    it(f, () => {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      const before = doc.documentElement.outerHTML
      const targets: Element[] = []
      for (const b of extract(doc)) {
        if (b.kind === 'text') targets.push(b.el)
        else for (const c of b.cells) if (!c.numeric) targets.push(c.el)
      }
      let markers = 0
      let escaped = 0
      let labels = 0
      for (const target of targets) {
        const block = serialize(target, 'markers')
        expect(block.paired.size, `${f} markers 不该产生成对占位符`).toBe(0)
        markers += block.slots.size
        escaped += (block.text.match(/@@/g) ?? []).length

        const v = validate(block.text, block)
        expect(v.ok, `${f} 恒等校验失败：${target.id || target.className}`).toBe(true)

        const fragment = rehydrate(block.text, block, doc)
        // 文字相等：转义 + 拍平不该动一个**非空白**字符。空白数量从 #119 起在 serialize 出口折叠，
        // 所以按同一口径两侧都折叠再比——少一个词、掉一处词间空格仍然会红
        const [gotText, wantText] = sameModuloWhitespace(fragment.textContent ?? '', target.textContent ?? '')
        expect(gotText, `${f} 文字对不上：${target.id || target.className}`).toBe(wantText)
        // The placeholder sequence is compared through the slot records rehydrate kept (the `slot`
        // entries of `offsets`, in wire order). It used to count the fragment's root elements —
        // markers has no open token, so every clone hung off the root — but since #150 a block's
        // leading label is wrapped back in a shell (`label.ts`): the shell is no placeholder, and a
        // placeholder can sit inside it.
        // 只比标签名——比 outerHTML 要给几万个公式各建一个几十 KB 的串，实测 4 GB 堆都不够。
        // 相邻同名节点被换位由上面那条 textContent 相等挡住（它们的文字不同），深克隆的保真度由 tags 那组覆盖
        const want = tokenize(block.text, 'markers').flatMap(t => (t.kind === 'void' ? [(block.slots.get(t.id) as Element).tagName] : []))
        const got = fragment.offsets.flatMap(s => (s.kind === 'slot' ? [(s.node as Element).tagName] : []))
        expect(got, `${f} 受保护节点对不上：${target.id || target.className}`).toEqual(want)
        // A shell only ever opens the fragment, and only as a copy of the element the block opens with
        const first = fragment.firstChild
        if (first?.nodeType === 1 && (first as Element).matches(LABEL_FORMATTING) && !fragment.offsets.some(s => s.node === first)) {
          labels++
          expect((first as Element).className, `${f} 标签壳的 class 应与原元素一致：${target.id}`).toBe(target.firstElementChild?.className)
        }

      }
      console.info(`[protector/markers] ${f}: ${targets.length} 个块，${markers} 个记号，${escaped} 处 @ 转义，${labels} 个段首标签包回`)
      expect(doc.documentElement.outerHTML).toBe(before)
    })
  }
})
