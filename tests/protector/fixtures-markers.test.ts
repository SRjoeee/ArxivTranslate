import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
// The runs path's markers coverage is in runs.test.ts: running the 12 papers here would only be “does not throw”, with no assertion,
// yet in parallel with the tags file it pushes the heaviest fixture to the 10 s budget line (measured on CI: 10223 ms)
import { rehydrate, serialize, tokenize, validate } from '@/core/protector'
import { LABEL_FORMATTING } from '@/core/rules/latexml'
import { sameModuloWhitespace } from './helpers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

// The markers format (#104). A file of its own: sharing a worker with the tags group accumulates 26 documents of 1.8 MB, measured to blow the 4 GB heap
// The markers format (#104): a plain-text wire, voids only, paired placeholders flattened. The equivalence is therefore one notch weaker than tags —
// inline wrapper elements (<em> and the like) vanish, so innerHTML cannot be compared; compared is “the text character for character, the protected nodes as they were and in order”.
describe('fixture round trip (markers)', () => {
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
        expect(block.paired.size, `${f} markers must not produce paired placeholders`).toBe(0)
        markers += block.slots.size
        escaped += (block.text.match(/@@/g) ?? []).length

        const v = validate(block.text, block)
        expect(v.ok, `${f} identity validation failed: ${target.id || target.className}`).toBe(true)

        const fragment = rehydrate(block.text, block, doc)
        // Text equality: escaping + flattening must not move one **non-whitespace** character. Whitespace counts are collapsed at serialize's exit since #119,
        // so both sides are collapsed by the same rule before comparing — one word missing, one inter-word space dropped still goes red
        const [gotText, wantText] = sameModuloWhitespace(fragment.textContent ?? '', target.textContent ?? '')
        expect(gotText, `${f} text does not match: ${target.id || target.className}`).toBe(wantText)
        // The placeholder sequence is compared through the slot records rehydrate kept (the `slot`
        // entries of `offsets`, in wire order). It used to count the fragment's root elements —
        // markers has no open token, so every clone hung off the root — but since #150 a block's
        // leading label is wrapped back in a shell (`label.ts`): the shell is no placeholder, and a
        // placeholder can sit inside it.
        // Tag names only — comparing outerHTML would build a string of tens of KB for each of tens of thousands of formulas; measured: even a 4 GB heap is not enough.
        // Adjacent same-name nodes swapped are caught by the textContent equality above (their text differs); the fidelity of the deep clone is covered by the tags group
        const want = tokenize(block.text, 'markers').flatMap(t => (t.kind === 'void' ? [(block.slots.get(t.id) as Element).tagName] : []))
        const got = fragment.offsets.flatMap(s => (s.kind === 'slot' ? [(s.node as Element).tagName] : []))
        expect(got, `${f} protected nodes do not match: ${target.id || target.className}`).toEqual(want)
        // A shell only ever opens the fragment, and only as a copy of the element the block opens with
        const first = fragment.firstChild
        if (first?.nodeType === 1 && (first as Element).matches(LABEL_FORMATTING) && !fragment.offsets.some(s => s.node === first)) {
          labels++
          expect((first as Element).className, `${f} the label shell's class should match the original element: ${target.id}`).toBe(target.firstElementChild?.className)
        }

      }
      console.info(`[protector/markers] ${f}: ${targets.length} blocks, ${markers} markers, ${escaped} @ escapes, ${labels} leading labels wrapped back`)
      expect(doc.documentElement.outerHTML).toBe(before)
    })
  }
})
