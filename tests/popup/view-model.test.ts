import { describe, expect, it } from 'vitest'
import { POPUP_FIXTURES } from '@/entrypoints/popup/fixtures'
import { derivePopupView, runnable } from '@/entrypoints/popup/view-model'

const input = (id: string) => POPUP_FIXTURES.find(f => f.id === id)!.input
const view = (id: string) => derivePopupView(input(id))
/** Every string a reader could see in a view (values only; keys are code) */
const words = (v: unknown): string => typeof v === 'string' ? v : v && typeof v === 'object' ? Object.values(v).map(words).join(' ') : ''

describe('derivePopupView (UI.md §4)', () => {
  it('derives every fixture, with no developer words and no state pill in the output', () => {
    for (const f of POPUP_FIXTURES) {
      const text = words(derivePopupView(f.input))
      expect(text, f.id).not.toMatch(/引擎|降级|块|会话|fallback|provider|就绪|翻译中/)
    }
  })
  it('P0 is one sentence', () => {
    expect(view('P0').empty).toBe(true)
  })
  it('P1 ready: the default service, no note, translate with the shortcut, both switches on', () => {
    const v = view('P1')
    expect(v.service).toEqual({ value: 'Microsoft 翻译' })
    expect(v.language.value).toBe('简体中文')
    expect(v.prompt).toBeNull()
    expect(v.note).toBeNull()
    expect(v.failed).toBeNull()
    expect(v.menu).toBeNull()
    expect(v.helper).toBeNull()
    expect(v.primary).toEqual({ label: '翻译本页', action: 'translate', disabled: false, shortcut: '⌥T' })
    expect(v.secondary).toBeNull()
    expect(v.highlight).toBe(true)
    expect(v.images).toBe(true)
  })
  it('P2 service menu: the three built-ins, the reader\'s own, then the way to the settings page', () => {
    const m = view('P2').menu!
    expect(m.kind).toBe('service')
    expect(m.search).toBe(false)
    expect(m.items.map(i => i.id)).toEqual(['microsoft', 'google-web', 'chrome-builtin', '__manage'])
    expect(m.items.map(i => i.selected)).toEqual([true, false, false, false])
    expect(m.items[2]).toMatchObject({ name: 'Chrome 翻译', disabled: true, action: { label: '下载' } })
    expect(m.items[3]).toMatchObject({ name: '管理翻译服务…' })
    const ready = derivePopupView({ ...input('P2'), pack: 'available' }).menu!
    expect(ready.items[2]).toMatchObject({ hint: '浏览器内置，无需联网' })
    expect(ready.items[2]!.disabled).toBeFalsy()
    expect(ready.items[2]!.action).toBeUndefined()
    const busy = derivePopupView({ ...input('P2'), pack: 'downloading' }).menu!
    expect(busy.items[2]).toMatchObject({ disabled: true, hint: '语言包下载中', action: { busy: true } })
  })

  it("a reader's services sit where the contract puts the LLM — after the free ones, before Chrome (S-P-46)", () => {
    const llm = input('P15')
    const m = derivePopupView({ ...llm, menu: 'service' }).menu!
    expect(m.items.map(i => i.id)).toEqual(['microsoft', 'google-web', llm.config!.services[0]!.id, 'chrome-builtin', '__manage'])
    const own = m.items[2]!
    expect(own).toMatchObject({ id: llm.config!.services[0]!.id, name: 'deepseek-v4-flash', hint: 'deepseek/deepseek-v4-flash', selected: true })
    // Without a key the row still selects; the note under the card is what says it cannot run
    const noKey = derivePopupView({ ...llm, config: { ...llm.config!, services: [{ ...llm.config!.services[0]!, apiKey: '' }] }, menu: 'service' }).menu!
    expect(noKey.items[2]).toMatchObject({ hint: '尚未配置 API Key' })
    expect(noKey.items[2]!.disabled).toBeFalsy()
  })
  it('P3 language menu: every language, searchable by any of its names or its code', () => {
    const m = view('P3').menu!
    expect(m.search).toBe(true)
    expect(m.items.length).toBeGreaterThan(150)
    const cmn = m.items.find(i => i.id === 'cmn')!
    expect(cmn.selected).toBe(true)
    expect(cmn.keywords).toMatch(/Mandarin/)
    expect(cmn.keywords).toMatch(/cmn/)
  })
  it('P4 translating: the button says it, the rows stay open, no counts anywhere', () => {
    const v = view('P4')
    expect(v.primary).toEqual({ label: '显示原文', action: 'restore', disabled: false })
    expect(v.note).toBeNull()
    expect(JSON.stringify(v)).not.toMatch(/24|31/)
  })
  it('P5 one failure line counting paragraphs and figures together', () => {
    expect(view('P5').failed).toBe('3 处翻译失败')
  })
  it('P6 replaced: the service in use, the one put aside struck, a note with the reason and the settings button', () => {
    const v = view('P6')
    expect(v.service).toEqual({ value: 'Google 翻译', replaced: 'deepseek-v4-flash' })
    expect(v.note).toEqual({ text: 'deepseek-v4-flash：API Key 无效或已过期。本页已改用 Google 翻译', settings: true })
    expect(v.primary.action).toBe('restore')
  })
  it('P7 LLM without a key, another service takes over: note says which, translate stays enabled', () => {
    const v = view('P7')
    expect(v.note).toEqual({ text: 'LLM 尚未配置 API Key，本次将使用 Microsoft 翻译', settings: true })
    expect(v.primary.disabled).toBe(false)
    expect(v.prompt).toEqual({ value: 'Default' })
  })
  it('P8 LLM without a key and nothing to take over: note and a disabled button', () => {
    const v = view('P8')
    expect(v.note).toEqual({ text: 'LLM 尚未配置 API Key', settings: true })
    expect(v.primary).toEqual({ label: '翻译本页', action: 'translate', disabled: true })
  })
  it('P9 paused: the reason, retranslate plus show-original', () => {
    const v = view('P9')
    expect(v.note).toEqual({ text: 'API Key 无效或已过期。请检查设置后重新翻译', settings: true })
    expect(v.primary).toEqual({ label: '重新翻译', action: 'retranslate', disabled: false, shortcut: '⌥T' })
    expect(v.secondary).toEqual({ label: '显示原文', action: 'restore' })
  })
  it('P10 Chrome chosen while its pack downloads: the note says so and who takes over', () => {
    const v = view('P10')
    expect(v.note?.text).toBe('Chrome 翻译的语言包下载中，约需 1 分钟，本次将使用 Google 翻译')
    expect(v.primary.disabled).toBe(false)
  })
  it('P11 paused image translation is a note, the page keeps going', () => {
    const v = view('P11')
    expect(v.note?.text).toBe('图片翻译已暂停：API Key 无效或已过期')
    expect(v.primary.action).toBe('restore')
  })
  it('P12 narrow-window note', () => {
    expect(view('P12').mode).toEqual({ value: 'side', note: '窗口较窄，暂按上下显示' })
  })
  it('P13 a choice that cannot run leaves the page behind: note, retranslate disabled, show-original', () => {
    const v = view('P13')
    expect(v.note).toEqual({ text: 'LLM 尚未配置 API Key', settings: true })
    expect(v.primary).toEqual({ label: '重新翻译', action: 'retranslate', disabled: true })
    expect(v.secondary).toEqual({ label: '显示原文', action: 'restore' })
  })
  it('P14 helper missing on macOS: install text, a copyable command with the extension id, a guide link', () => {
    const v = view('P14')
    expect(v.helper).toEqual({ text: '图片翻译需要安装识别助手', command: expect.stringMatching(/^curl -fsSL .*install-remote\.sh \| bash -s -- abcdefghijklmnopabcdefghijklmnop\b/), guide: expect.stringMatching(/helper\/README/) })
    expect(derivePopupView({ ...input('P14'), platform: 'other' }).helper).toEqual({ text: '图片翻译目前仅支持 macOS' })
    expect(derivePopupView({ ...input('P14'), config: { ...input('P14').config!, image: { enabled: false, modes: [] } } }).helper).toBeNull()
  })
  it('P15 prompt menu lists the built-ins and the reader\'s own', () => {
    const m = view('P15').menu!
    expect(m.kind).toBe('prompt')
    expect(m.items[0]).toMatchObject({ id: 'default', name: 'Default', selected: true })
  })
  it('runnable follows the settings alone', () => {
    const c = input('P1').config!
    const svc = input('P15').config!.services[0]!
    expect(runnable(c, null)).toBe(true)
    expect(runnable({ ...c, provider: 'chrome-builtin' }, 'downloadable')).toBe(false)
    expect(runnable({ ...c, provider: 'chrome-builtin' }, 'available')).toBe(true)
    expect(runnable({ ...c, provider: 'google-web' }, null)).toBe(true)
    // A service needs a key, unless it is a local endpoint: Ollama and LM Studio answer without one
    expect(runnable({ ...c, provider: svc.id, services: [svc] }, null)).toBe(true)
    expect(runnable({ ...c, provider: svc.id, services: [{ ...svc, apiKey: '' }] }, null)).toBe(false)
    expect(runnable({ ...c, provider: svc.id, services: [{ ...svc, apiKey: '', baseURL: 'http://127.0.0.1:11434/v1' }] }, null)).toBe(true)
  })
})
