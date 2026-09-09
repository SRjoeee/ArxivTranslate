import { describe, expect, it } from 'vitest'
import { boundariesOf, sentencePairs, verifyAlignment } from '@/providers/alignment'

describe('alignment verification (#105)', () => {
  const src = 'One sentence. Two here.'
  const tgt = '第一句。第二句。'
  const good = { source: [14, 9], target: [4, 4] }

  it('accepts an alignment that partitions both texts exactly', () => {
    // 值相等而不是同一个对象：闸门会把偏了一两个字符的边界吸回句末标点（见下），
    // 返回的可能是修正过的那一份
    expect(verifyAlignment(good, src, tgt)).toEqual(good)
    expect(good.source.reduce((a, b) => a + b, 0)).toBe(src.length)
    expect(good.target.reduce((a, b) => a + b, 0)).toBe(tgt.length)
  })

  it('nudges a boundary that missed its sentence end by a character', () => {
    // 引擎报的是它自己认为的句边界，偶尔差一两个字符：微软在 arxiv.org/html/2509.10652v3 上报回
    // `…对话式工作流程。这|种新兴的…`，把下一句的第一个字算进了上一句（用户 2026-09-09 反馈，实测复现）。
    // 划分本身是精确的，所以下游任何一道闸都拦不住，只有读者看得见
    const source = 'A workflow. This emerging style.'
    const target = '工作流程。这种新兴的风格。'
    expect(verifyAlignment({ source: [12, 20], target: [6, 7] }, source, target)).toEqual({ source: [12, 20], target: [5, 8] })
  })

  it('does not reach across a clause to find a sentence end', () => {
    // 窗口只够跨过标点本身，不够跨过一个词组。实测引擎的位移都是一两个字符；放宽窗口不会多修好
    // 一条，只会让「附近碰巧有个句号」的边界被拉过去
    const source = 'A workflow. This emerging style.'
    const target = '工作流程。这种新兴的风格。'
    const given = { source: [12, 20], target: [9, 4] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('leaves a boundary alone when there is no sentence end to snap to', () => {
    // 参考文献里的作者名单：引擎报的「句子」根本不是句子，附近没有句末标点，就不该动它
    const source = 'Smith, Lee, Wong and Chan'
    const target = '史密斯、李、黄和陈'
    const given = { source: [11, 14], target: [4, 5] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('leaves a boundary that already sits after a placeholder alone', () => {
    // 占位符与空白不算「没在句末」：紧贴在它们后面的边界本来就在正确的位置，
    // 把它当成偏了会去移动一个对的边界——这正是这条规则最该避免的事
    const source = 'Done. See it. Next.'
    const target = '完成。<x id="1"/>接着说。'
    const given = { source: [6, 8, 5], target: [3, 11, 4] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('refuses a snap that would leave a sentence with nothing visible in it', () => {
    // 吸到句末标点之后会让最后一句只剩一个收尾标签：那不是「一句话」，宁可让边界留在原处。
    // 实测这条守卫拿掉之后，同一批数据里凭空多出 3 个没有可见文字的句子
    const source = 'It holds. It is sound.'
    const target = '谓词<x id="2"/>声音。</t>'
    const given = { source: [10, 12], target: [13, 7] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('counts every spelling of a placeholder as filler, not as visible text', () => {
    // 引擎可能把占位符写成 `<x id='1' />` 或 `<x id=1></x>`，`validate` 认这些是同一个占位符。
    // 用更窄的写法去认，这些变体就被当成「可见文字」，那道「不许留下空句」的守卫会被绕过
    //（Codex 在 #145 指出）
    const source = 'A. B.'
    const target = "甲。<x id='1' />"
    const given = { source: [3, 2], target: [1, target.length - 1] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('does not snap onto the period of an abbreviation or a decimal', () => {
    // `Vol. 2` 与 `3.5` 都以句点结尾，吸过去就把卷号和数字劈开了（Codex 在 #145 指出）。
    // 判据是句点后面跟的是不是小写字母或数字——是的话这个句点不属于句末
    const source = 'Vol. 2 Publisher. Next.'
    const target = '第一。第二。'
    // 切点落在 `Vol. 2` 之后——它自己不在句末，所以**会**去找候选；唯一够得着的候选就是 `Vol.`
    // 那个句点，必须被否掉。（切在 `Vol. ` 之后的话它自身就 settled，根本走不到这段判断）
    const cut = source.indexOf('2') + 1
    const given = { source: [cut, source.length - cut], target: [3, 3] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('snaps past the whole terminator, not just its first character', () => {
    // `。”` 与 `...` 是一个结尾。停在里面，剩下的那半个标点就跑去开下一句了（Codex 在 #145 指出）
    const source = 'He spoke. Then more.'
    const target = '他说完了。”接着说。'
    expect(verifyAlignment({ source: [10, 10], target: [4, 6] }, source, target))
      .toEqual({ source: [10, 10], target: [6, 4] })
  })

  it('does not second-guess a boundary that already sits after punctuation', () => {
    // `…（为什么？）|接着用它` 这种：标点上是settled 的，就不是我们该改的。把「能不能吸过去」的
    // 严格判据也用在「它现在对不对」上，反而会把 `?)` 从中间劈开——实测语料上真出现过一次
    const source = 'Ask (why?) using it. Next.'
    const target = '第一。第二。'
    const given = { source: [source.indexOf('using'), source.length - source.indexOf('using')], target: [3, 3] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('rejects a source partition that does not add up to the text', () => {
    // The engine reporting boundaries for a string other than the one we sent is the failure this
    // catches — trusting it would put the highlight on the wrong characters.
    expect(verifyAlignment({ source: [14, 8], target: [4, 4] }, src, tgt)).toBeUndefined()
  })

  it('rejects a target partition that does not add up', () => {
    expect(verifyAlignment({ source: [14, 9], target: [4, 5] }, src, tgt)).toBeUndefined()
  })

  it('rejects unequal sentence counts, which have no pairing to offer', () => {
    // The highlight pairs sentence i with sentence i. An engine that merged two source sentences
    // into one target sentence cannot be paired, so the honest answer is no highlight.
    expect(verifyAlignment({ source: [14, 9], target: [8] }, src, tgt)).toBeUndefined()
  })

  it('rejects empty, zero-length and non-integer entries', () => {
    expect(verifyAlignment({ source: [], target: [] }, '', '')).toBeUndefined()
    expect(verifyAlignment({ source: [23, 0], target: [8, 0] }, src, tgt)).toBeUndefined()
    expect(verifyAlignment({ source: [14.5, 8.5], target: [4, 4] }, src, tgt)).toBeUndefined()
  })

  it('rejects nothing at all', () => {
    expect(verifyAlignment(undefined, src, tgt)).toBeUndefined()
  })

  it('expands into per-sentence intervals that tile each text', () => {
    expect(boundariesOf([14, 9])).toEqual([0, 14, 23])
    expect(sentencePairs(good)).toEqual([
      { index: 0, source: { from: 0, to: 14 }, target: { from: 0, to: 4 } },
      { index: 1, source: { from: 14, to: 23 }, target: { from: 4, to: 8 } },
    ])
    expect(src.slice(0, 14)).toBe('One sentence. ')
    expect(tgt.slice(4, 8)).toBe('第二句。')
  })
})
