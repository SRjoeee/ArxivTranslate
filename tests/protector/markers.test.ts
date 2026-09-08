// 纯文本记号格式（#104，DESIGN §6.1）：`@a#`，只有 void，成对占位符拍平。
// 实测依据见 tokens.ts 的文件头：微软 Edge 端点在标签格式上 0%、在记号上 98%，Google 两种都 ~99%。
import { describe, expect, it } from 'vitest'
import { escapeText, expectationsFromText, fromAlpha, rehydrate, serialize, toAlpha, tokenize, unescapeText, validate } from '@/core/protector'
import { el, htmlOf } from './helpers'

// 'Let @a# be bold per @b#.'（<em> 被拍平，<a class=ltx_ref> 是受保护节点）
const source = '<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph">bold</em> per <a class="ltx_ref" href="#S2">2</a>.</p>'
const block = () => serialize(el(source), 'markers')
const reason = (translated: string) => {
  const r = validate(translated, block())
  return r.ok ? 'ok' : r.reason
}

describe('id ↔ 字母', () => {
  it('双射二十六进制：1→a、26→z、27→aa', () => {
    for (const [n, s] of [[1, 'a'], [2, 'b'], [26, 'z'], [27, 'aa'], [28, 'ab'], [52, 'az'], [53, 'ba'], [702, 'zz'], [703, 'aaa']] as const) {
      expect([n, toAlpha(n)]).toEqual([n, s])
      expect([s, fromAlpha(s)]).toEqual([s, n])
    }
  })

  it('往返到远超真实块的规模也不撞', () => {
    const seen = new Set<string>()
    for (let i = 1; i <= 3000; i++) {
      const s = toAlpha(i)
      expect(seen.has(s)).toBe(false)
      seen.add(s)
      expect(fromAlpha(s)).toBe(i)
    }
  })
})

describe('serialize（markers）', () => {
  it('void 写成记号，成对元素拍平，带功能的元素仍整块保留', () => {
    const b = block()
    // <em> 没有槽位（拍平），<math> 与 <a> 各占一个
    expect(b.text).toBe('Let @a# be bold per @b#.')
    expect(b.paired.size).toBe(0)
    expect(b.slots.size).toBe(2)
    expect((b.slots.get(2) as Element).tagName).toBe('A')
  })

  it('同一个块在两种格式下的线上文本不同', () => {
    expect(serialize(el(source), 'tags').text).toBe('Let <x id="1"/> be <t id="2">bold</t> per <x id="3"/>.')
  })
})

describe('转义的不可伪造性', () => {
  it('每个 @ 无条件翻倍——转义不能依赖上下文', () => {
    // 条件转义（「只在后面跟着 [a-z]*[#@] 时翻倍」）在单个文本节点上看着没问题，
    // 但序列化是逐节点转义再拼接的，歧义会在拼接处产生。见下面那条边界测试
    expect(escapeText('a@b.com', 'markers')).toBe('a@@b.com')
    expect(escapeText('@app.route', 'markers')).toBe('@@app.route')
    expect(escapeText('ends with @', 'markers')).toBe('ends with @@')
    expect(escapeText('@abc#', 'markers')).toBe('@@abc#')
    expect(escapeText('@@', 'markers')).toBe('@@@@')
    expect(escapeText('no ats here', 'markers')).toBe('no ats here')
  })

  it('文本节点以 @ 结尾、紧接着一个受保护节点：占位符不能被吃掉（Codex 在 #107 指出）', () => {
    // 条件转义下这里会序列化成 `@@a#`，分词器读成字面量 @，<math> 的占位符凭空消失，
    // 校验永远失败、runs 兜底也会把公式当文字丢掉
    for (const html of [
      '<p class="ltx_p">@<math class="ltx_Math"><mi>x</mi></math></p>',
      '<p class="ltx_p">a@<math class="ltx_Math"><mi>x</mi></math>b</p>',
      '<p class="ltx_p">@@<math class="ltx_Math"><mi>x</mi></math></p>',
      '<p class="ltx_p">@a<math class="ltx_Math"><mi>x</mi></math>#</p>',
    ]) {
      const b = serialize(el(html), 'markers')
      const voids = tokenize(b.text, 'markers').filter(t => t.kind === 'void')
      expect([html, voids.length]).toEqual([html, b.slots.size])
      expect([html, validate(b.text, b).ok]).toEqual([html, true])
      const doc = el('<p></p>').ownerDocument
      expect([html, rehydrate(b.text, b, doc).querySelectorAll('math').length]).toEqual([html, 1])
      expect([html, rehydrate(b.text, b, doc).textContent]).toEqual([html, el(html).textContent])
    }
  })

  it('转义 → 分词是恒等的：任何字面量都还原回自己，且不产生占位符', () => {
    for (const s of ['@abc#', '@@abc#', '@#', '@a@b#', '@@@', 'a@b.com', '@app.route @x# tail']) {
      const tokens = tokenize(escapeText(s, 'markers'), 'markers')
      expect([s, tokens.filter(t => t.kind !== 'text').length]).toEqual([s, 0])
      expect([s, tokens.map(t => (t.kind === 'text' ? t.text : '')).join('')]).toEqual([s, s])
    }
  })

  it('原文里字面的 @a# 不会被当成占位符——沉浸式翻译正是栽在这一步', () => {
    const b = serialize(el('<p class="ltx_p">写作 @a# 时 <math class="ltx_Math"><mi>x</mi></math> 成立</p>'), 'markers')
    // 字面量被转义成 @@a#，真占位符是 @a#
    expect(b.text).toBe('写作 @@a# 时 @a# 成立')
    expect(b.slots.size).toBe(1)
    const doc = el('<p></p>').ownerDocument
    expect(htmlOf(rehydrate(b.text, b, doc))).toBe('写作 @a# 时 <math class="ltx_Math"><mi>x</mi></math> 成立')
  })

  it('markers 不做 HTML 转义：这条线是纯文本，< 不是结构字符', () => {
    expect(escapeText('a < b & c > d', 'markers')).toBe('a < b & c > d')
    expect(escapeText('a < b & c > d', 'tags')).toBe('a &lt; b &amp; c &gt; d')
  })
})

describe('validate（markers）', () => {
  it('恒等与语序调换都通过', () => {
    expect(reason('令 @a# 为粗体，见 @b#。')).toBe('ok')
    expect(reason('@b# 之后，粗体与 @a#')).toBe('ok')
  })

  it('五种破坏各自被认出来', () => {
    expect(reason('令 @a# 为粗体。')).toBe('missing')
    expect(reason('@a# @a# @b#')).toBe('duplicate')
    expect(reason('@a# @b# @z#')).toBe('unknown')
    // markers 没有成对记号，unbalanced / kind-mismatch 在这条线上不可能出现：
    // 分词器只产出 void 与 text，也就没有 open/close 与种类可错
    expect(tokenize('@a# <t id="1">x</t> @b#', 'markers').filter(t => t.kind !== 'text' && t.kind !== 'void')).toEqual([])
  })

  it('引擎把记号写成别的形状就会被挡下（这正是要挡的失败模式）', () => {
    expect(reason('令 @ a # 为粗体，见 @b#。')).toBe('missing')
    expect(reason('令 @A# 为粗体，见 @b#。')).toBe('missing')
    expect(reason('令 @1# 为粗体，见 @b#。')).toBe('missing')
  })
})

describe('expectationsFromText（markers）', () => {
  it('从请求文本反推出的期望与 serialize 的一致', () => {
    const b = block()
    const e = expectationsFromText(b.text, 'markers')
    expect([...e.slots.keys()].sort()).toEqual([...b.slots.keys()].sort())
    expect(e.paired.size).toBe(0)
  })

  it('格式传错就一个占位符都认不出来——校验会变成恒真，坏译文会静默进缓存', () => {
    const b = block()
    // 这条断言钉住的是「洞长什么样」，translate-service 必须按 renderPath 传格式
    expect(expectationsFromText(b.text, 'tags').slots.size).toBe(0)
    expect(validate('完全没有占位符的译文', expectationsFromText(b.text, 'tags')).ok).toBe(true)
    // 传对了就挡得住
    expect(validate('完全没有占位符的译文', expectationsFromText(b.text, 'markers')).ok).toBe(false)
  })
})

describe('纯文本往返（标题与 OCR 行）', () => {
  // 这两条路没有分词器：escapeText → 翻译 → unescapeText。用 decodeText 会原样返回，
  // 于是标题里会多出一个 @（Codex 在 #107 指出）
  it('转义 → 反转义是恒等的，包括连续的 @', () => {
    for (const s of ['@abc#', '@@abc#', '@#', '@a@b#', '@@@', '@@@@', 'a@b.com', 'plain title']) {
      expect([s, unescapeText(escapeText(s, 'markers'), 'markers')]).toEqual([s, s])
    }
  })

  it('markers 的反转义不解 HTML 实体：那会把 OCR 出来的字面量 &amp; 吃掉', () => {
    expect(unescapeText('a &amp; b', 'markers')).toBe('a &amp; b')
    expect(unescapeText('a &amp; b', 'tags')).toBe('a & b')
  })

  it('占位符路径不能用它：tokenize 已经还原过一遍，再来一次会把字面量 @@ 吃成 @', () => {
    const escaped = escapeText('@@', 'markers')
    expect(tokenize(escaped, 'markers').map(t => (t.kind === 'text' ? t.text : '')).join('')).toBe('@@')
    expect(unescapeText(unescapeText(escaped, 'markers'), 'markers')).toBe('@')
  })
})
