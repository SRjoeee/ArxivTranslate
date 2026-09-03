import { describe, expect, it } from 'vitest'
import { serialize, validate } from '@/core/protector'
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
