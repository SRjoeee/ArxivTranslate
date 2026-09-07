import { describe, expect, it } from 'vitest'
import { IMG_CLASS, INJECTED_SELECTOR, T_CLASS, isInjected, stripInjected } from '@/core/marks'
import { serialize } from '@/core/protector'

// 注入标记（DESIGN §7.1 / §15.2）：图片叠加层是第三种注入节点，不带 axt-t，但提取、序列化、克隆清理都要认它

describe('isInjected / stripInjected', () => {
  it('译文与图片叠加层都算注入节点，普通元素不算', () => {
    const doc = new DOMParser().parseFromString(`<div><p class="${T_CLASS}">译</p><div class="${IMG_CLASS}"><span>标签</span></div><p class="ltx_p">原文</p></div>`, 'text/html')
    const [t, img, p] = Array.from(doc.body.firstElementChild!.children)
    expect(isInjected(t!)).toBe(true)
    expect(isInjected(img!)).toBe(true)
    expect(isInjected(p!)).toBe(false)
    expect(doc.querySelectorAll(INJECTED_SELECTOR)).toHaveLength(2)
  })

  it('克隆清理把叠加层一起删掉：镜像 / 译文表整块克隆时不能把别人的叠加层带进去', () => {
    const doc = new DOMParser().parseFromString(`<div id="root"><img class="ltx_graphics" src="a.png" id="g"><div class="${IMG_CLASS}" data-axt-for="g"><span>标签</span></div><p class="${T_CLASS}">译</p></div>`, 'text/html')
    const root = doc.getElementById('root')!
    stripInjected(root)
    expect(root.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(root.querySelector(`.${T_CLASS}`)).toBeNull()
    expect(root.querySelector('img')).not.toBeNull()
    expect(root.querySelector('img')!.id).toBe('')
  })

  it('序列化跳过叠加层：块里的图上叠了译文标签，再翻这个块时标签文字不能进 prompt', () => {
    // 叠加层真实是 div，这里用 span：HTML 解析会让 <div> 截断 <p>，考的是按 class 跳过、不是标签
    const doc = new DOMParser().parseFromString(`<p class="ltx_p">See <img class="ltx_graphics" src="a.png"><span class="${IMG_CLASS}"><span>静态电荷</span></span> here.</p>`, 'text/html')
    const block = serialize(doc.querySelector('p')!)
    expect(block.text).not.toContain('静态电荷')
    expect(block.text).toMatch(/See <x id="\d+"\/> here\./)
  })
})
