import { describe, expect, it } from 'vitest'
import { POPUP_FIXTURES } from '@/entrypoints/popup/fixtures'
import { derivePopupView } from '@/entrypoints/popup/view-model'

const view = (id: string) => derivePopupView(POPUP_FIXTURES.find(f => f.id === id)!.input)

describe('derivePopupView (UI.md §4)', () => {
  it('derives every fixture, with no implementation words in the output', () => {
    for (const f of POPUP_FIXTURES) {
      const v = derivePopupView(f.input)
      const text = JSON.stringify(v)
      expect(text, f.id).not.toMatch(/引擎|降级|块|会话|fallback|provider|helper/)
    }
  })
  it('P0 is one sentence', () => {
    expect(view('P0').empty).toBe(true)
  })
  it('P1 ready: green pill, openable, translate', () => {
    const v = view('P1')
    expect(v.service).toMatchObject({ name: 'deepseek-v4-flash', pill: { text: '就绪', tone: 'ok' }, canOpen: true })
    expect(v.primary).toEqual({ label: '翻译本页', action: 'translate', disabled: false, shortcut: '⌥T' })
    expect(v.note).toBeNull()
    expect(v.failed).toBeNull()
    expect(v.list).toBeNull()
    expect(v.highlight).toEqual({ on: true, label: '对照高亮', title: '指到哪句亮哪句；仅译文时停留一下会浮出原文' })
  })
  it('P2 list: four services, the AI one with a prompt row, the offline one with a download', () => {
    const v = view('P2')
    expect(v.list?.options.map(o => o.id)).toEqual(['openai-compat', 'google-web', 'chrome-builtin', 'microsoft'])
    const options = v.list!.options
    expect(options.map(o => o.selected)).toEqual([true, false, false, false])
    expect(options.map(o => o.download)).toEqual([undefined, undefined, 'ready', undefined])
    expect(options[3]).toMatchObject({ name: 'Microsoft 翻译', disabled: false })
    expect(v.list?.prompts?.[0]).toEqual({ id: 'default', name: 'Default' })
  })
  it('P3 busy: spinning pill, nothing openable, restore, no counts', () => {
    const v = view('P3')
    expect(v.service.pill).toEqual({ text: '翻译中', tone: 'busy', spinning: true })
    expect(v.service.canOpen).toBe(false)
    expect(v.language.canOpen).toBe(false)
    expect(v.primary).toEqual({ label: '显示原文', action: 'restore', disabled: false })
    expect(JSON.stringify(v)).not.toMatch(/24|31/)
  })
  it('P4 joins paragraphs and images in one failure line', () => {
    expect(view('P4').failed).toBe('2 段、1 张图没翻出来')
  })
  it('P5 replaced: new name, old name struck, note with the reason and a fix link', () => {
    const v = view('P5')
    expect(v.service.name).toBe('Google 翻译')
    // The one put aside is named like the list names it: the AI service by its model, not the
    // engine's own "OpenAI 兼容端点"
    expect(v.service.replaced).toBe('deepseek-v4-flash')
    expect(v.service.pill).toMatchObject({ text: '已改用', tone: 'alert' })
    expect(v.note).toEqual({ text: 'deepseek-v4-flash：API Key 无效或已过期。后面的段落改用 Google 翻译，专业术语可能不准', tone: 'alert', link: '去修' })
  })
  it('P6 will fall back: amber pill, button enabled', () => {
    const v = view('P6')
    expect(v.service.pill).toMatchObject({ text: '将改用', tone: 'warn' })
    expect(v.primary.disabled).toBe(false)
    expect(v.note?.text).toBe('还没有填写 API Key，这次会用 Google 翻译')
  })
  it('P7 needs setup: button disabled, note says the way out', () => {
    const v = view('P7')
    expect(v.primary.disabled).toBe(true)
    expect(v.note).toEqual({ text: '还没有填写 API Key，填好就能翻译', tone: 'warn', link: '去填' })
  })
  it('P8 paused: retranslate plus restore', () => {
    const v = view('P8')
    expect(v.service.pill).toMatchObject({ text: '已暂停' })
    expect(v.primary).toEqual({ label: '重新翻译', action: 'translate', disabled: false, shortcut: '⌥T' })
    expect(v.secondary).toEqual({ label: '显示原文', action: 'restore' })
    expect(v.note?.text).toBe('API Key 无效或已过期。改好设置后点「重新翻译」')
  })
  it('P9 stopped without a fatal error is ready', () => {
    const v = view('P9')
    expect(v.service.pill.text).toBe('就绪')
    expect(v.primary.label).toBe('翻译本页')
    expect(v.secondary).toBeNull()
  })
  it('P10 config fallback outranks every other note', () => {
    const v = view('P10')
    expect(v.service.pill.text).toBe('需要设置')
    expect(v.note).toEqual({ text: '设置没能读取，正在用默认设置', tone: 'alert', link: '去查看' })
  })
  it('P11 downloading: spinner, button disabled', () => {
    const v = view('P11')
    expect(v.service.pill).toEqual({ text: '下载中', tone: 'muted', spinning: true })
    expect(v.primary.disabled).toBe(true)
  })
  it('P12 paused image translation changes the note, not the pill', () => {
    const v = view('P12')
    expect(v.service.pill.text).toBe('翻译中')
    expect(v.note?.text).toBe('图片翻译已暂停：API Key 无效或已过期。显示原文、改好设置后再翻译')
  })
  it('P13 narrow-window note', () => {
    const v = view('P13')
    expect(v.mode).toEqual({ value: 'side', note: '窗口较窄，暂按上下显示' })
  })
  it('the shortcut badge rides only on an enabled translate button, and only when bound', () => {
    expect(view('P3').primary.shortcut).toBeUndefined()
    expect(view('P7').primary.shortcut).toBeUndefined()
    expect(view('P8').primary.shortcut).toBe('⌥T')
    const f = POPUP_FIXTURES.find(f => f.id === 'P1')!.input
    expect(derivePopupView({ ...f, shortcut: null }).primary.shortcut).toBeUndefined()
  })
  it('the highlight toggle follows the config and is off when it says so', () => {
    const f = POPUP_FIXTURES.find(f => f.id === 'P1')!.input
    const off = derivePopupView({ ...f, config: { ...f.config!, reading: { sentenceHighlight: false } } })
    expect(off.highlight.on).toBe(false)
  })
})
