import { describe, expect, it } from 'vitest'
import { extract, type Block } from '@/core/extractor'
import { startTranslation, type Progress, type Transport } from '@/core/pipeline/run'
import { FOR_ATTR, INLINE_ATTR, PARTIAL_ATTR, PENDING_CLASS, STATE_ATTR, T_CLASS } from '@/core/renderer'
import { TABLE_RULES } from '@/core/rules/latexml'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import type { TranslateCall } from '@/providers/translate-service'

const PAGE =
  '<h2 class="ltx_title ltx_title_section" id="s1">Introduction</h2>'
  + '<p class="ltx_p" id="p1">One <math class="ltx_Math"><mi>x</mi></math>.</p>'
  + '<p class="ltx_p" id="p2">Two <math class="ltx_Math"><mi>y</mi></math> here.</p>'
  + '<h2 class="ltx_title ltx_title_section" id="s2">Method</h2>'
  + '<p class="ltx_p" id="p3">Three.</p>'
  + '<table class="ltx_tabular" id="T1"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table>'

const docOf = (page = PAGE) => new DOMParser().parseFromString(`<!doctype html><html><head></head><body><article class="ltx_document">${page}</article></body></html>`, 'text/html')

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

/** 开始会话并等标记完成；happy-dom 没有 IntersectionObserver，块要靠 translate 手动交出去 */
async function start(doc: Document, blocks: Block[], transport: Transport, extra: Partial<Parameters<typeof startTranslation>[0]> = {}) {
  const run = startTranslation({
    doc, blocks, target: 'zh-CN', mode: 'stack', paper: 'test', transport, preload: DEFAULT_PRELOAD,
    capabilities: { maxBatchChars: 100_000, maxBatchItems: 100, preservesMarkup: true }, ...extra,
  })
  await run.ready
  return run
}
const byId = (blocks: Block[], id: string) => blocks.find(b => b.id === id)!

describe('startTranslation', () => {
  it('开始只打标记不发请求；交出去的块攒批翻完，进度与缓存计数正确', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport, requests } = makeTransport()
    const run = await start(doc, blocks, transport)
    expect(requests).toHaveLength(0)
    expect(doc.querySelectorAll(`[${STATE_ATTR}="pending"]`)).toHaveLength(blocks.length)
    expect(run.progress()).toEqual({ state: 'on', total: 6, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0 })
    await run.translate(blocks)
    expect(run.progress()).toEqual({ state: 'on', total: 6, requested: 6, done: 6, failed: 0, cached: 3, inFlight: 0 })
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(6)
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
    // 两个章节各一批文本 + 表格一批
    expect(requests).toHaveLength(3)
    expect(requests[0]?.cache).toEqual({ paper: 'test', renderPath: 'markup' })
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)?.querySelector('math')).not.toBeNull()
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="T1"]`)?.querySelector(TABLE_RULES.cell)?.textContent).toBe('Model')
    expect(doc.documentElement.hasAttribute('data-axt-on')).toBe(true)
  })

  it('只翻交出去的块；章节标题来自开始时对整篇算好的表，不在这一批里的标题也算数（§10）', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport, requests } = makeTransport()
    const run = await start(doc, blocks, transport)
    await run.translate([byId(blocks, 'p3')])
    expect(requests).toHaveLength(1)
    expect(requests[0]!.request.segments.map(s => s.id)).toEqual(['p3'])
    expect(requests[0]!.request.context?.sectionTitle).toBe('Method')
    expect(doc.getElementById('s2')?.getAttribute(STATE_ATTR)).toBe('pending')
    expect(run.progress()).toMatchObject({ requested: 1, done: 1 })
    // 再交一次同一块：请求中的跳过，已完成的当作重试再翻一次
    await run.translate([byId(blocks, 'p3')])
    expect(requests).toHaveLength(2)
  })

  it('请求期间原块后面是带圆环的 pending 节点，进度里算 inFlight；译文到达后被替换', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const transport: Transport = async req => {
      await gate
      return { ok: true, result: { segments: req.request.segments.map(s => ({ id: s.id, text: s.text })), provider: 'mock' }, cached: 0 }
    }
    const seen: Progress[] = []
    const run = await start(doc, blocks, transport, { onProgress: p => seen.push(p) })
    const pending = run.translate([byId(blocks, 'p1')])
    const node = doc.getElementById('p1')!.nextElementSibling!
    expect(node.classList.contains(PENDING_CLASS)).toBe(true)
    expect(node.querySelector('.axt-spinner')).not.toBeNull()
    expect(run.progress()).toMatchObject({ requested: 1, inFlight: 1, done: 0 })
    expect(seen.at(-1)).toMatchObject({ inFlight: 1 })
    release()
    await pending
    expect(doc.getElementById('p1')!.nextElementSibling!.classList.contains(PENDING_CLASS)).toBe(false)
    expect(doc.querySelectorAll('.axt-spinner')).toHaveLength(0)
    expect(seen.at(-1)).toMatchObject({ inFlight: 0, done: 1 })
  })

  it('占位符破坏一次：单块重发（只写不读缓存）后成功', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    let corrupted = false
    const { transport, requests } = makeTransport((_req, seg) => {
      if (seg.id === 'p2' && !corrupted) { corrupted = true; return '坏了' }
      return undefined as unknown as string
    })
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    expect(run.progress()).toMatchObject({ done: 6, failed: 0 })
    const retry = requests.find(r => r.request.segments.length === 1 && r.request.segments[0]?.id === 'p2')
    expect(retry?.cache).toEqual({ paper: 'test', renderPath: 'markup', bypass: true })
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)?.querySelector('math')).not.toBeNull()
  })

  it('占位符始终破坏：走 runs 兜底；markup 请求带校验回调，runs 请求不带', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport, requests } = makeTransport((req, seg) => {
      if (seg.id === 'p2' && req.cache?.renderPath === 'markup') return '坏了'
      return undefined as unknown as string
    })
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    expect(run.progress().failed).toBe(0)
    const runsReq = requests.find(r => r.cache?.renderPath === 'runs')
    expect(runsReq?.request.segments.map(s => s.id)).toEqual(['p2#r0', 'p2#r1'])
    const markup = requests.find(r => r.cache?.renderPath === 'markup')!
    expect(markup.accept?.('p2', '坏了')).toBe(false)
    expect(markup.accept?.('p2', markup.request.segments.find(s => s.id === 'p2')!.text)).toBe(true)
    expect(runsReq?.accept).toBeUndefined()
    const node = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)
    expect(node?.querySelector('math')).not.toBeNull()
    expect(node?.textContent).toContain('Two')
  })

  it('批次报错：对半拆分到单段，只标记真正失败的块，pending 随之删掉', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport } = makeTransport((req, seg) => (req.request.segments.some(s => s.id === 'p1') && seg.id === 'p1' ? { error: 'unknown' } : undefined as unknown as string))
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    expect(run.progress()).toMatchObject({ failed: 1, done: 5, inFlight: 0 })
    expect(doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)).toBeNull()
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)).not.toBeNull()
  })

  it('no-key：致命错误后会话停下，不再发新批次', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport, requests } = makeTransport(() => ({ error: 'no-key' }))
    const run = await start(doc, blocks, transport)
    await run.translate([byId(blocks, 'p1')])
    expect(requests).toHaveLength(1)
    expect(run.progress()).toMatchObject({ state: 'stopped', failed: 1 })
    expect(run.progress().fatal).toContain('no-key')
    await run.translate([byId(blocks, 'p3')])
    expect(requests).toHaveLength(1)
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
  })

  it('stop：删掉 pending、之后回来的译文不渲染、进度不再上报', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const transport: Transport = async req => {
      await gate
      return { ok: true, result: { segments: req.request.segments.map(s => ({ id: s.id, text: s.text })), provider: 'mock' }, cached: 0 }
    }
    const seen: Progress[] = []
    const run = await start(doc, blocks, transport, { onProgress: p => seen.push(p) })
    const pending = run.translate([byId(blocks, 'p1')])
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(1)
    const reportsBefore = seen.length
    run.stop()
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
    expect(run.progress().state).toBe('stopped')
    release()
    await pending
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(0)
    expect(seen).toHaveLength(reportsBefore)
    await run.translate([byId(blocks, 'p2')])
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
  })

  it('取消范围 scope 透传给每一次调用；没给就不带', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport, requests } = makeTransport()
    const run = await start(doc, blocks, transport, { scope: 'run-1' })
    await run.translate(blocks)
    expect(requests.length).toBeGreaterThan(0)
    for (const r of requests) expect(r.scope).toBe('run-1')
    const bare = makeTransport()
    const doc2 = docOf()
    const blocks2 = extract(doc2)
    await (await start(doc2, blocks2, bare.transport)).translate(blocks2)
    for (const r of bare.requests) expect(r.scope).toBeUndefined()
  })

  it('论文级上下文（标题、摘要）带到每一批，并与批次的章节标题合并', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport, requests } = makeTransport()
    await (await start(doc, blocks, transport, { context: { paperTitle: 'P', abstract: 'A' } })).translate(blocks)
    expect(requests.length).toBeGreaterThan(0)
    for (const r of requests) {
      expect(r.request.context?.paperTitle).toBe('P')
      expect(r.request.context?.abstract).toBe('A')
    }
    expect(requests.map(r => r.request.context?.sectionTitle)).toContain('Introduction')
  })

  it('表格翻了一半：已翻出的格照常显示，原表保持 translated 另加 partial 标记，计入 failed', async () => {
    const doc = docOf('<table class="ltx_tabular" id="T2"><tbody><tr><td class="ltx_td">Alpha</td><td class="ltx_td">Beta</td></tr></tbody></table>')
    const blocks = extract(doc)
    const { transport } = makeTransport((_req, seg) => (seg.id === 'T2#c1' ? { error: 'unknown' } : undefined as unknown as string))
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    expect(run.progress()).toMatchObject({ done: 0, failed: 1 })
    const original = doc.getElementById('T2')!
    expect(original.getAttribute(STATE_ATTR)).toBe('translated')
    expect(original.hasAttribute(PARTIAL_ATTR)).toBe(true)
    const clone = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="T2"]`)
    expect(Array.from(clone?.querySelectorAll(TABLE_RULES.cell) ?? []).map(td => td.textContent)).toEqual(['Alpha', 'Beta'])
    await (await start(doc, blocks, makeTransport().transport)).translate(blocks)
    expect(original.hasAttribute(PARTIAL_ATTR)).toBe(false)
  })

  it('短标题再翻失败：删译文的同时摘掉同行标记；再翻成功加回', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    await (await start(doc, blocks, makeTransport().transport)).translate(blocks)
    const title = doc.getElementById('s1')!
    expect(title.hasAttribute(INLINE_ATTR)).toBe(true)
    const { transport } = makeTransport((_req, seg) => (seg.id === 's1' ? { error: 'unknown' } : undefined as unknown as string))
    await (await start(doc, blocks, transport)).translate(blocks)
    expect(title.getAttribute(STATE_ATTR)).toBe('failed')
    expect(title.hasAttribute(INLINE_ATTR)).toBe(false)
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="s1"]`)).toBeNull()
    await (await start(doc, blocks, makeTransport().transport)).translate(blocks)
    expect(title.hasAttribute(INLINE_ATTR)).toBe(true)
  })

  it('再翻失败的块要删掉上一轮的译文，不能挂着旧译文冒充这一轮', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    await (await start(doc, blocks, makeTransport().transport)).translate(blocks)
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)).not.toBeNull()
    const { transport } = makeTransport((_req, seg) => (seg.id === 'p1' ? { error: 'unknown' } : undefined as unknown as string))
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    expect(run.progress().failed).toBe(1)
    expect(doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)).toBeNull()
    expect(doc.querySelectorAll(`.${T_CLASS}[${FOR_ATTR}="p3"]`)).toHaveLength(1)
  })
})
