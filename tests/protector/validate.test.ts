import { describe, expect, it } from 'vitest'
import { expectationsFromText, serialize, validate } from '@/core/protector'
import { el } from './helpers'

// 'Let <x id="1"/> be <t id="2">bold</t> per <x id="3"/>.'
const block = () => serialize(el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph">bold</em> per <a class="ltx_ref" href="#S2">2</a>.</p>'))
const reason = (translated: string) => {
  const r = validate(translated, block())
  return r.ok ? 'ok' : r.reason
}

describe('validate', () => {
  it('恒等与语序调换都通过', () => {
    expect(reason('令 <x id="1"/> 为 <t id="2">粗体</t>，见 <x id="3"/>。')).toBe('ok')
    expect(reason('<x id="3"/> 之后，<t id="2">粗体</t> 与 <x id="1"/>')).toBe('ok')
  })

  it('容忍常见写法变体', () => {
    expect(reason('<x id="1" /> a <t id=\'2\'>b</t> c <x id=3></x>')).toBe('ok')
  })

  it('丢失 void 或 paired', () => {
    expect(reason('令 <x id="1"/> 为 <t id="2">粗体</t>。')).toBe('missing')
    expect(reason('<x id="1"/> a <x id="3"/>')).toBe('missing')
  })

  it('重复', () => {
    expect(reason('<x id="1"/><x id="1"/> <t id="2">a</t> <x id="3"/>')).toBe('duplicate')
    expect(reason('<x id="1"/> <t id="2">a</t><t id="2">b</t> <x id="3"/>')).toBe('duplicate')
  })

  it('未知 id', () => {
    expect(reason('<x id="1"/> <t id="2">a</t> <x id="3"/> <x id="9"/>')).toBe('unknown')
  })

  it('paired 未闭合或多余闭合', () => {
    expect(reason('<x id="1"/> <t id="2">a <x id="3"/>')).toBe('unbalanced')
    expect(reason('<x id="1"/> <t id="2">a</t></t> <x id="3"/>')).toBe('unbalanced')
  })

  it('void 与 paired 种类互换', () => {
    expect(reason('<t id="1">x</t> <t id="2">a</t> <x id="3"/>')).toBe('kind-mismatch')
    expect(reason('<x id="1"/> <x id="2"/> <x id="3"/>')).toBe('kind-mismatch')
  })

  it('paired 嵌套合法', () => {
    const b = serialize(el('<p class="ltx_p"><span class="ltx_text">A <em class="ltx_emph">B</em></span></p>'))
    expect(validate('<t id="1">甲 <t id="2">乙</t></t>', b).ok).toBe(true)
    expect(validate('<t id="2">乙</t><t id="1">甲</t>', b).ok).toBe(true)
  })

  it('失败结果带 detail', () => {
    const r = validate('nothing', block())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toMatch(/1/)
  })
})

describe('expectationsFromText（issue #42：期望从请求文本反推，不跨消息传 accept）', () => {
  it('反推出的期望与 serialize 的结果等价：同一段译文两边判一样', () => {
    const b = block()
    const derived = expectationsFromText(b.text)
    expect([...derived.slots.keys()].sort()).toEqual([...b.slots.keys()].sort())
    expect([...derived.paired].sort()).toEqual([...b.paired].sort())
    for (const translated of [
      '令 <x id="1"/> 为 <t id="2">粗体</t>，见 <x id="3"/>。',
      '令 <x id="1"/> 为 <t id="2">粗体</t>。',
      '<x id="1"/><x id="1"/> <t id="2">a</t> <x id="3"/>',
      '<x id="1"/> <x id="2"/> <x id="3"/>',
      '<x id="1"/> <t id="2">a</t> <x id="3"/> <x id="9"/>',
      'nothing',
    ]) {
      expect([translated, validate(translated, derived)]).toEqual([translated, validate(translated, b)])
    }
  })

  it('嵌套的 paired 也认得出来', () => {
    const b = serialize(el('<p class="ltx_p"><span class="ltx_text">A <em class="ltx_emph">B</em></span></p>'))
    const derived = expectationsFromText(b.text)
    expect([...derived.paired].sort()).toEqual([...b.paired].sort())
    expect(derived.slots.size).toBe(b.slots.size)
  })

  it('runs 路径的纯文本没有槽位：译文里凭空冒出的标签会被判 unknown，不许进缓存', () => {
    const derived = expectationsFromText('a plain run without placeholders')
    expect(derived.slots.size).toBe(0)
    expect(validate('一段纯译文', derived).ok).toBe(true)
    expect(validate('一段 <x id="1"/> 译文', derived)).toMatchObject({ ok: false, reason: 'unknown' })
  })

  it('多余的 </t> 不算槽位，扫描不被它带偏', () => {
    expect(expectationsFromText('a </t> b <x id="4"/>')).toMatchObject({ slots: new Map([[4, null]]), paired: new Set() })
  })
})
