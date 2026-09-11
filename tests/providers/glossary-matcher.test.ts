// 只发这一段用到的术语（DESIGN §8.2）。坑逐条对着 Read Frog 的 matcher 抄教训——
// 他们为此发过两次修复，失败模式都是"术语明明配了，却悄悄不生效"。
import { describe, expect, it } from 'vitest'
import { createGlossaryMatcher, type GlossaryEntry } from '@/providers/glossary'

const entries = (...pairs: [string, string][]): GlossaryEntry[] => pairs.map(([term, translation]) => ({ term, translation }))
const terms = (list: GlossaryEntry[], text: string) => createGlossaryMatcher(list).match(text).map(e => e.term)

describe('createGlossaryMatcher', () => {
  it('只挑出文中真的出现的术语', () => {
    const list = entries(['attention', '注意力'], ['kernel', '核'], ['manifold', '流形'])
    expect(terms(list, 'We revisit the attention mechanism over a learned kernel.')).toEqual(['attention', 'kernel'])
    expect(terms(list, 'Nothing relevant here.')).toEqual([])
  })

  it('顺序按术语表，不按出现位置：同一组术语要渲染成同一段提示词，否则缓存键会碎', () => {
    const list = entries(['attention', '注意力'], ['kernel', '核'])
    expect(terms(list, 'kernel then attention')).toEqual(['attention', 'kernel'])
    expect(terms(list, 'attention then kernel')).toEqual(['attention', 'kernel'])
  })

  it('词边界：net 不进 network，但 network 自己照常命中', () => {
    const list = entries(['net', '网'], ['network', '网络'])
    expect(terms(list, 'a neural network layer')).toEqual(['network'])
    expect(terms(list, 'the net effect')).toEqual(['net'])
  })

  it('命中位置边界不对时继续往后找，不会漏掉后面真正的那一处（Read Frog #2175 的教训）', () => {
    const list = entries(['net', '网'])
    // 第一处在 network 里面，应当跳过；第二处才是真的
    expect(terms(list, 'network and then the net')).toEqual(['net'])
  })

  it('术语里的空白当成任意空白：页面上的软换行、两个空格、不换行空格都算', () => {
    const list = entries(['neural network', '神经网络'])
    for (const text of ['a neural network', 'a neural  network', 'a neural\nnetwork', 'a neural network']) {
      expect([text, terms(list, text)]).toEqual([text, ['neural network']])
    }
    // 术语自己多打了空格也要能用（他们踩过：术语进了索引却永远匹配不上）
    expect(terms(entries(['neural   network', '神经网络']), 'a neural network')).toEqual(['neural   network'])
  })

  it('大小写不敏感；两边都先 NFC，组合字符与预组合字符算同一个词', () => {
    expect(terms(entries(['Transformer', '变换器']), 'a transformer block')).toEqual(['Transformer'])
    // 术语用分解写法（e + U+0301），正文用预组合写法（U+00E9）：看着一样，不归一就比不等
    const decomposed = 'cafe\u0301'
    expect(decomposed.normalize('NFC')).not.toBe(decomposed)
    expect(terms(entries([decomposed, '咖啡馆']), 'at the caf\u00e9 tonight')).toEqual([decomposed])
  })

  it('连写的文字不要求词边界：汉字之间本来就没有空格', () => {
    expect(terms(entries(['流形', 'manifold']), '这是一个流形结构')).toEqual(['流形'])
  })

  // Codex 在 #163 指出：目标语言表里还有几种连写的文字，少了它们术语永远匹配不上
  it('高棉语、老挝语、缅甸语、藏语也是连写的，同样不要求词边界', () => {
    // 每组：术语 + 把它夹在同文字的正文里
    const cases: [string, string][] = [
      ['ការបកប្រែ', 'នេះជាការបកប្រែដ៏ល្អ'], // 高棉语「翻译」
      ['ການແປ', 'ນີ້ແມ່ນການແປທີ່ດີ'], // 老挝语
      ['ဘာသာပြန်', 'ဤသည်ဘာသာပြန်ကောင်းသည်'], // 缅甸语
      ['སྒྱུར', 'འདིསྒྱུརབཟང'], // 藏语
    ]
    for (const [term, text] of cases) {
      expect([term, terms(entries([term, 'x']), text)]).toEqual([term, [term]])
    }
  })

  it('以符号收尾的术语照常命中：C++ 后面跟着句号不算词边界问题', () => {
    expect(terms(entries(['C++', 'C++']), 'written in C++.')).toEqual(['C++'])
    expect(terms(entries(['(a)', '（a）']), 'panel (a) shows')).toEqual(['(a)'])
  })

  it('正则元字符按字面匹配，不当模式', () => {
    expect(terms(entries(['O(n^2)', 'O(n²)']), 'costs O(n^2) time')).toEqual(['O(n^2)'])
  })

  it('空表与空术语不产生匹配，也不抛错', () => {
    expect(createGlossaryMatcher([]).match('anything')).toEqual([])
    expect(createGlossaryMatcher(entries(['  ', 'x'])).size).toBe(0)
    expect(terms(entries(['attention', '注意力']), '')).toEqual([])
  })
})
