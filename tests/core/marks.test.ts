import { describe, expect, it } from 'vitest'
import { IMG_CLASS, INJECTED_SELECTOR, T_CLASS, isInjected, stripInjected } from '@/core/marks'
import { serialize } from '@/core/protector'

// Injection markers (DESIGN §7.1 / §15.2): image overlays are a third injected node type without axt-t; extraction, serialization, and clone cleanup must recognize them.

describe('isInjected / stripInjected', () => {
  it('translations and image overlays count as injected nodes; ordinary elements do not', () => {
    const doc = new DOMParser().parseFromString(`<div><p class="${T_CLASS}">译</p><div class="${IMG_CLASS}"><span>标签</span></div><p class="ltx_p">原文</p></div>`, 'text/html')
    const [t, img, p] = Array.from(doc.body.firstElementChild!.children)
    expect(isInjected(t!)).toBe(true)
    expect(isInjected(img!)).toBe(true)
    expect(isInjected(p!)).toBe(false)
    expect(doc.querySelectorAll(INJECTED_SELECTOR)).toHaveLength(2)
  })

  it('clone cleanup removes overlays so mirror and translated-table clones cannot carry another element overlay', () => {
    const doc = new DOMParser().parseFromString(`<div id="root"><img class="ltx_graphics" src="a.png" id="g"><div class="${IMG_CLASS}" data-axt-for="g"><span>标签</span></div><p class="${T_CLASS}">译</p></div>`, 'text/html')
    const root = doc.getElementById('root')!
    stripInjected(root)
    expect(root.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(root.querySelector(`.${T_CLASS}`)).toBeNull()
    expect(root.querySelector('img')).not.toBeNull()
    expect(root.querySelector('img')!.id).toBe('')
  })

  it('serialization skips overlays so translating an image-containing block cannot include translated overlay labels in the prompt', () => {
    // Real overlays are divs; use a span here because HTML parsing would close the p before a div. This tests class-based exclusion, not tag names.
    const doc = new DOMParser().parseFromString(`<p class="ltx_p">See <img class="ltx_graphics" src="a.png"><span class="${IMG_CLASS}"><span>静态电荷</span></span> here.</p>`, 'text/html')
    const block = serialize(doc.querySelector('p')!)
    expect(block.text).not.toContain('静态电荷')
    expect(block.text).toMatch(/See <x id="\d+"\/> here\./)
  })
})
