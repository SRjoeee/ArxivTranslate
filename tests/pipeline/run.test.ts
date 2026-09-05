import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { runTranslation, type Transport } from '@/core/pipeline/run'
import { FOR_ATTR, PARTIAL_ATTR, STATE_ATTR, T_CLASS } from '@/core/renderer'
import { TABLE_RULES } from '@/core/rules/latexml'
import type { TranslateCall } from '@/providers/translate-service'

const PAGE =
  '<p class="ltx_p" id="p1">One <math class="ltx_Math"><mi>x</mi></math>.</p>'
  + '<p class="ltx_p" id="p2">Two <math class="ltx_Math"><mi>y</mi></math> here.</p>'
  + '<p class="ltx_p" id="p3">Three.</p>'
  + '<table class="ltx_tabular" id="T1"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table>'

const docOf = () => new DOMParser().parseFromString(`<!doctype html><html><head></head><body><article class="ltx_document">${PAGE}</article></body></html>`, 'text/html')

/** 恒等 transport：原样返回；可用 mutate 篡改某些段 */
function makeTransport(mutate?: (req: TranslateCall, seg: { id: string; text: string }, calls: number) => string | { error: string }) {
  const requests: TranslateCall[] = []
  const transport: Transport = async req => {
    requests.push(req)
    const segments: { id: string; text: string }[] = []
    for (const seg of req.request.segments) {
      const out = mutate?.(req, seg, requests.length)
      if (out && typeof out === 'object') return { ok: false, error: { kind: out.error as 'unknown', message: out.error } }
      segments.push({ id: seg.id, text: typeof out === 'string' ? out : seg.text })
    }
    return { ok: true, result: { segments, provider: 'mock' }, cached: 1 }
  }
  return { transport, requests }
}

const run = (doc: Document, transport: Transport, extra: Partial<Parameters<typeof runTranslation>[0]> = {}) =>
  runTranslation({
    doc, blocks: extract(doc), target: 'zh-CN', mode: 'stack', paper: 'test', transport,
    capabilities: { maxBatchChars: 100_000, maxBatchItems: 100, preservesMarkup: true }, concurrency: 1, ...extra,
  })

describe('runTranslation', () => {
  it('恒等 transport：全部渲染，进度与缓存计数正确', async () => {
    const doc = docOf()
    const { transport, requests } = makeTransport()
    const progress = await run(doc, transport)
    expect(progress).toEqual({ state: 'done', total: 4, done: 4, failed: 0, cached: 2 })
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(4)
    expect(requests).toHaveLength(2)
    expect(requests[0]?.cache).toEqual({ paper: 'test', renderPath: 'markup' })
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)?.querySelector('math')).not.toBeNull()
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="T1"]`)?.querySelector(TABLE_RULES.cell)?.textContent).toBe('Model')
    expect(doc.documentElement.hasAttribute('data-axt-on')).toBe(true)
  })

  it('占位符破坏一次：单块重发后成功', async () => {
    const doc = docOf()
    let corrupted = false
    const { transport, requests } = makeTransport((_req, seg) => {
      if (seg.id === 'p2' && !corrupted) { corrupted = true; return '坏了' }
      return undefined as unknown as string
    })
    const progress = await run(doc, transport)
    expect(progress.failed).toBe(0)
    expect(progress.done).toBe(4)
    const retry = requests.find(r => r.request.segments.length === 1 && r.request.segments[0]?.id === 'p2')
    // 重发只写不读：坏译文已经进了缓存，照常读只会原样拿回来（Codex 在 #9 指出）
    expect(retry?.cache).toEqual({ paper: 'test', renderPath: 'markup', bypass: true })
    expect(requests[0]?.cache).toEqual({ paper: 'test', renderPath: 'markup' })
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)?.querySelector('math')).not.toBeNull()
  })

  it('占位符始终破坏：走 runs 兜底', async () => {
    const doc = docOf()
    const { transport, requests } = makeTransport((req, seg) => {
      if (seg.id === 'p2' && req.cache?.renderPath === 'markup') return '坏了'
      return undefined as unknown as string
    })
    const progress = await run(doc, transport)
    expect(progress.failed).toBe(0)
    const runsReq = requests.find(r => r.cache?.renderPath === 'runs')
    expect(runsReq?.request.segments.map(s => s.id)).toEqual(['p2#r0', 'p2#r1'])
    // markup 请求带校验回调：坏译文不许写缓存，好的放行；runs 请求不带（拼回时才校验）
    const markup = requests.find(r => r.cache?.renderPath === 'markup')!
    expect(markup.accept?.('p2', '坏了')).toBe(false)
    expect(markup.accept?.('p2', markup.request.segments.find(s => s.id === 'p2')!.text)).toBe(true)
    expect(runsReq?.accept).toBeUndefined()
    const node = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)
    expect(node?.querySelector('math')).not.toBeNull()
    expect(node?.textContent).toContain('Two')
  })

  it('批次报错：对半拆分到单段，只标记真正失败的块', async () => {
    const doc = docOf()
    const { transport } = makeTransport((req, seg) => (req.request.segments.some(s => s.id === 'p1') && seg.id === 'p1' ? { error: 'unknown' } : undefined as unknown as string))
    const progress = await run(doc, transport)
    expect(progress.failed).toBe(1)
    expect(progress.done).toBe(3)
    expect(doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)).toBeNull()
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p3"]`)).not.toBeNull()
  })

  it('no-key：运行终止，不再发后续批次', async () => {
    const doc = docOf()
    const { transport, requests } = makeTransport(() => ({ error: 'no-key' }))
    const progress = await run(doc, transport)
    expect(progress.fatal).toContain('no-key')
    expect(requests).toHaveLength(1)
    expect(progress.state).toBe('done')
  })

  it('中止：第一批之后不再发请求', async () => {
    const doc = docOf()
    const controller = new AbortController()
    const { transport, requests } = makeTransport(() => { controller.abort(); return undefined as unknown as string })
    const progress = await run(doc, transport, { signal: controller.signal })
    expect(requests).toHaveLength(1)
    expect(progress.state).toBe('cancelled')
  })

  it('视口优先：isPriority 标记的块所在批次先发，其余按文档序', async () => {
    const doc = docOf()
    const { transport, requests } = makeTransport()
    await run(doc, transport, { capabilities: { maxBatchChars: 100_000, maxBatchItems: 1, preservesMarkup: true }, isPriority: b => b.id === 'p3' })
    expect(requests.map(r => r.request.segments[0]?.id)).toEqual(['p3', 'p1', 'p2', 'T1#c0'])
  })

  it('onProgress 每批回调，表格批次也算', async () => {
    const doc = docOf()
    const seen: { done: number; state: string }[] = []
    const { transport, requests } = makeTransport()
    await run(doc, transport, { onProgress: p => seen.push({ done: p.done, state: p.state }) })
    expect(seen[seen.length - 1]!.done).toBe(4)
    // 文本批 + 表格批各上报一次。表格分支曾经 return 得太早跳过了上报，
    // popup 计数与 side prep 都收不到（Codex 在 #26 指出）
    expect(requests).toHaveLength(2)
    expect(seen.filter(p => p.state === 'running')).toHaveLength(2)
  })

  it('取消范围 scope 透传给每一次调用；没给就不带', async () => {
    const doc = docOf()
    const { transport, requests } = makeTransport()
    await run(doc, transport, { scope: 'run-1' })
    expect(requests.length).toBeGreaterThan(0)
    for (const r of requests) expect(r.scope).toBe('run-1')
    const bare = makeTransport()
    await run(docOf(), bare.transport)
    for (const r of bare.requests) expect(r.scope).toBeUndefined()
  })

  it('论文级上下文（标题、摘要）带到每一批，并与批次的章节标题合并', async () => {
    const doc = docOf()
    const { transport, requests } = makeTransport()
    await run(doc, transport, { context: { paperTitle: 'P', abstract: 'A' } })
    expect(requests.length).toBeGreaterThan(0)
    for (const r of requests) {
      expect(r.request.context?.paperTitle).toBe('P')
      expect(r.request.context?.abstract).toBe('A')
    }
  })

  it('表格翻了一半：已翻出的格照常显示，但块标失败、计入 failed（Codex 在 #9 指出）', async () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><head></head><body><article class="ltx_document">'
      + '<table class="ltx_tabular" id="T2"><tbody><tr><td class="ltx_td">Alpha</td><td class="ltx_td">Beta</td></tr></tbody></table>'
      + '</article></body></html>', 'text/html',
    )
    const { transport } = makeTransport((_req, seg) => (seg.id === 'T2#c1' ? { error: 'unknown' } : undefined as unknown as string))
    const progress = await run(doc, transport)
    expect(progress).toMatchObject({ done: 0, failed: 1 })
    // 原表仍是 translated（only 模式只显示克隆，不会原表与半份克隆一起露出来），另打 partial 标记
    const original = doc.getElementById('T2')!
    expect(original.getAttribute(STATE_ATTR)).toBe('translated')
    expect(original.hasAttribute(PARTIAL_ATTR)).toBe(true)
    const clone = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="T2"]`)
    expect(Array.from(clone?.querySelectorAll(TABLE_RULES.cell) ?? []).map(td => td.textContent)).toEqual(['Alpha', 'Beta'])
    // 再翻全部成功：标记随之清掉
    await run(doc, makeTransport().transport)
    expect(original.hasAttribute(PARTIAL_ATTR)).toBe(false)
  })

  it('短标题再翻失败：删译文的同时摘掉同行标记，否则没有译文的标题仍被压成 inline-block（Codex 在 #30 指出）', async () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><head></head><body><article class="ltx_document">'
      + '<h2 class="ltx_title ltx_title_section" id="s1">Introduction</h2><p class="ltx_p" id="p1">Text.</p>'
      + '</article></body></html>', 'text/html',
    )
    await run(doc, makeTransport().transport)
    const title = doc.getElementById('s1')!
    expect(title.hasAttribute('data-axt-inline')).toBe(true)
    const { transport } = makeTransport((_req, seg) => (seg.id === 's1' ? { error: 'unknown' } : undefined as unknown as string))
    await run(doc, transport)
    expect(title.getAttribute(STATE_ATTR)).toBe('failed')
    expect(title.hasAttribute('data-axt-inline')).toBe(false)
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="s1"]`)).toBeNull()
    // 再翻成功：标记加回来
    await run(doc, makeTransport().transport)
    expect(title.hasAttribute('data-axt-inline')).toBe(true)
  })

  it('再翻失败的块要删掉上一轮的译文，不能挂着旧译文冒充这一轮（Codex 在 #9 指出）', async () => {
    const doc = docOf()
    await run(doc, makeTransport().transport)
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)).not.toBeNull()
    const { transport } = makeTransport((_req, seg) => (seg.id === 'p1' ? { error: 'unknown' } : undefined as unknown as string))
    const progress = await run(doc, transport)
    expect(progress.failed).toBe(1)
    expect(doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)).toBeNull()
    expect(doc.querySelectorAll(`.${T_CLASS}[${FOR_ATTR}="p3"]`)).toHaveLength(1)
  })
})
