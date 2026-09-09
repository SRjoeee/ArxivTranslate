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
  it('accepts identity output and reordered text', () => {
    expect(reason('令 <x id="1"/> 为 <t id="2">粗体</t>，见 <x id="3"/>。')).toBe('ok')
    expect(reason('<x id="3"/> 之后，<t id="2">粗体</t> 与 <x id="1"/>')).toBe('ok')
  })

  it('tolerates common syntax variants', () => {
    expect(reason('<x id="1" /> a <t id=\'2\'>b</t> c <x id=3></x>')).toBe('ok')
  })

  it('missing void or paired slots', () => {
    expect(reason('令 <x id="1"/> 为 <t id="2">粗体</t>。')).toBe('missing')
    expect(reason('<x id="1"/> a <x id="3"/>')).toBe('missing')
  })

  it('duplicates', () => {
    expect(reason('<x id="1"/><x id="1"/> <t id="2">a</t> <x id="3"/>')).toBe('duplicate')
    expect(reason('<x id="1"/> <t id="2">a</t><t id="2">b</t> <x id="3"/>')).toBe('duplicate')
  })

  it('unknown IDs', () => {
    expect(reason('<x id="1"/> <t id="2">a</t> <x id="3"/> <x id="9"/>')).toBe('unknown')
  })

  it('unclosed paired slots or extra closing tags', () => {
    expect(reason('<x id="1"/> <t id="2">a <x id="3"/>')).toBe('unbalanced')
    expect(reason('<x id="1"/> <t id="2">a</t></t> <x id="3"/>')).toBe('unbalanced')
  })

  it('void and paired slot types exchanged', () => {
    expect(reason('<t id="1">x</t> <t id="2">a</t> <x id="3"/>')).toBe('kind-mismatch')
    expect(reason('<x id="1"/> <x id="2"/> <x id="3"/>')).toBe('kind-mismatch')
  })

  it('valid paired nesting', () => {
    const b = serialize(el('<p class="ltx_p"><span class="ltx_text">A <em class="ltx_emph">B</em></span></p>'))
    expect(validate('<t id="1">甲 <t id="2">乙</t></t>', b).ok).toBe(true)
    expect(validate('<t id="2">乙</t><t id="1">甲</t>', b).ok).toBe(true)
  })

  it('failure results include detail', () => {
    const r = validate('nothing', block())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toMatch(/1/)
  })
})

describe('expectationsFromText infers expectations from request text instead of passing accept through messaging (issue #42)', () => {
  it('inferred expectations match serialize: both judge the same translated output identically', () => {
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

  it('recognizes nested paired slots', () => {
    const b = serialize(el('<p class="ltx_p"><span class="ltx_text">A <em class="ltx_emph">B</em></span></p>'))
    const derived = expectationsFromText(b.text)
    expect([...derived.paired].sort()).toEqual([...b.paired].sort())
    expect(derived.slots.size).toBe(b.slots.size)
  })

  it('plain-text runs have no slots: invented tags are unknown and cannot enter the cache', () => {
    const derived = expectationsFromText('a plain run without placeholders')
    expect(derived.slots.size).toBe(0)
    expect(validate('一段纯译文', derived).ok).toBe(true)
    expect(validate('一段 <x id="1"/> 译文', derived)).toMatchObject({ ok: false, reason: 'unknown' })
  })

  it('extra closing t tags are not slots and do not confuse scanning', () => {
    expect(expectationsFromText('a </t> b <x id="4"/>')).toMatchObject({ slots: new Map([[4, null]]), paired: new Set() })
  })
})
