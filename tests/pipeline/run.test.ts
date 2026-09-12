import { describe, expect, it } from 'vitest'
import { extract, type Block } from '@/core/extractor'
import { startTranslation, type Progress, type Transport } from '@/core/pipeline/run'
import { T_CLASS } from '@/core/marks'
import { ERROR_CLASS, FOR_ATTR, INLINE_ATTR, PARTIAL_ATTR, PENDING_CLASS, STATE_ATTR } from '@/core/renderer/attrs'
import { TABLE_RULES } from '@/core/rules/latexml'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import type { TranslateCall } from '@/providers/translate-service'
import { reasonText } from '@/ui/strings'

const PAGE =
  '<h2 class="ltx_title ltx_title_section" id="s1">Introduction</h2>'
  + '<p class="ltx_p" id="p1">One <math class="ltx_Math"><mi>x</mi></math>.</p>'
  + '<p class="ltx_p" id="p2">Two <math class="ltx_Math"><mi>y</mi></math> here.</p>'
  + '<h2 class="ltx_title ltx_title_section" id="s2">Method</h2>'
  + '<p class="ltx_p" id="p3">Three.</p>'
  + '<table class="ltx_tabular" id="T1"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table>'

const docOf = (page = PAGE) => new DOMParser().parseFromString(`<!doctype html><html><head></head><body><article class="ltx_document">${page}</article></body></html>`, 'text/html')

/** 恒等 transport：原样返回；可用 mutate 篡改某些段 */
function makeTransport(mutate?: (req: TranslateCall, seg: { id: string; text: string }, calls: number) => string | { error: string; isolatable?: boolean; partial?: boolean }) {
  const requests: TranslateCall[] = []
  const transport: Transport = async req => {
    requests.push(req)
    const segments: { id: string; text: string }[] = []
    for (const seg of req.request.segments) {
      const out = mutate?.(req, seg, requests.length)
      // 默认按"某一段引起的"算：批次报错时 translateSegments 会对半拆到单段，
      // 现有用例正是靠这条路只标记真正失败的那一块。系统性失败另有用例显式传 isolatable: false
      if (out && typeof out === 'object') {
        // partial：这次调用里另一批已经译好的段落随失败一起回来（§8.2）
        const partial = out.partial ? req.request.segments.filter(s => s.id !== seg.id).map(s => ({ id: s.id, text: s.text })) : undefined
        return { ok: false, error: { kind: out.error as 'unknown', message: out.error, isolatable: out.isolatable ?? true }, ...(partial && partial.length > 0 ? { partial } : {}) }
      }
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
    capabilities: { maxBatchChars: 100_000, maxBatchItems: 100, renderPath: 'tags' }, ...extra,
  })
  await run.ready
  return run
}
const byId = (blocks: Block[], id: string) => blocks.find(b => b.id === id)!

describe('startTranslation', () => {
  it('reports the serving service on the first batch and on every hand-over, never twice in a row', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    let calls = 0
    const transport: Transport = async req => {
      calls++
      const provider = calls <= 1 ? 'llm' : 'free'
      return { ok: true, result: { segments: req.request.segments.map(seg => ({ id: seg.id, text: seg.text })), provider }, cached: 0 }
    }
    const seen: string[] = []
    const run = await start(doc, blocks, transport, { onProvider: id => seen.push(id) })
    await run.translate(blocks.slice(0, 1))
    await run.translate(blocks.slice(1, 2))
    await run.translate(blocks.slice(2, 3))
    expect(seen).toEqual(['llm', 'free'])
  })

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
    expect(requests[0]?.cache).toEqual({ paper: 'test', renderPath: 'tags' })
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

  it('请求期间原块后面是带骨架屏的 pending 节点，进度里算 inFlight；译文到达后被替换', async () => {
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
    expect(node.querySelector('.axt-skel')).not.toBeNull()
    expect(run.progress()).toMatchObject({ requested: 1, inFlight: 1, done: 0 })
    expect(seen.at(-1)).toMatchObject({ inFlight: 1 })
    release()
    await pending
    expect(doc.getElementById('p1')!.nextElementSibling!.classList.contains(PENDING_CLASS)).toBe(false)
    expect(doc.querySelectorAll('.axt-skel')).toHaveLength(0)
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
    expect(retry?.cache).toEqual({ paper: 'test', renderPath: 'tags', bypass: true })
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)?.querySelector('math')).not.toBeNull()
  })

  it('占位符始终破坏：走 runs 兜底；请求里不再带校验回调（issue #42 改由服务端从请求文本反推）', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport, requests } = makeTransport((req, seg) => {
      if (seg.id === 'p2' && req.cache?.renderPath === 'tags') return '坏了'
      return undefined as unknown as string
    })
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    expect(run.progress().failed).toBe(0)
    const runsReq = requests.find(r => r.cache?.renderPath === 'runs')
    expect(runsReq?.request.segments.map(s => s.id)).toEqual(['p2#r0', 'p2#r1'])
    const tags = requests.find(r => r.cache?.renderPath === 'tags')!
    // 请求只带得走的东西：段落、缓存参数、scope。校验回调过不了消息边界，也不再需要
    expect(Object.keys(tags).sort()).toEqual(['cache', 'request'])
    const node = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)
    expect(node?.querySelector('math')).not.toBeNull()
    expect(node?.textContent).toContain('Two')
  })

  it('批次报错：对半拆分到单段，只标记真正失败的块，pending 随之删掉', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    let fail = true
    const { transport } = makeTransport((_req, seg) => (fail && seg.id === 'p1' ? { error: 'unknown' } : undefined as unknown as string))
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    expect(run.progress()).toMatchObject({ failed: 1, done: 5, inFlight: 0 })
    expect(doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    // 失败块旁是带原因的小部件（§7.6），不是译文
    const widget = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)!
    expect(widget.classList.contains(ERROR_CLASS)).toBe(true)
    // 悬停看到的是按界面语言写的那一句，原始诊断在属性里（Codex 在 #161 指出）
    expect(widget.getAttribute('title')).toBe(reasonText('unknown'))
    expect(widget.getAttribute('data-axt-reason')).toBe('unknown: unknown')
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)?.classList.contains(ERROR_CLASS)).toBe(false)
    // failed() 列出失败块；再交给 translate 就是重试，成功后小部件换成译文
    expect(run.failed().map(b => b.id)).toEqual(['p1'])
    fail = false
    await run.translate(run.failed())
    expect(run.progress()).toMatchObject({ failed: 0, done: 6 })
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)?.classList.contains(ERROR_CLASS)).toBe(false)
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)?.querySelector('math')).not.toBeNull()
  })

  it('丢了占位符也不把公式挪到句末：两个从句各自留住自己的那个（研究审计 F03 的验收口径）', async () => {
    // Read Frog 的兜底是把丢掉的公式**追加在译文末尾**——一句话里两个从句、两个公式时，
    // 谁属于哪半句就没了。我们的 runs 兜底按位置重拼，所以位置是可以断言的
    const page = '<p class="ltx_p" id="two">If <math class="ltx_Math"><mi>x</mi></math> is positive then '
      + '<math class="ltx_Math"><mi>y</mi></math> is negative.</p>'
    const doc = docOf(page)
    const blocks = extract(doc)
    const { transport } = makeTransport((req, seg) => (seg.id === 'two' && req.cache?.renderPath === 'tags' ? '占位符全丢了' : undefined as unknown as string))
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    const node = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="two"]`)!
    expect(node.querySelectorAll('math')).toHaveLength(2)
    // 两个公式仍夹在各自那半句里：x 在 "If … is positive" 内，y 在 "then … is negative" 内
    const parts = Array.from(node.childNodes).map(n => n.nodeType === 1 ? (n as Element).textContent : n.textContent).join('|')
    expect(parts.indexOf('x')).toBeGreaterThan(parts.indexOf('If'))
    expect(parts.indexOf('x')).toBeLessThan(parts.indexOf('then'))
    expect(parts.indexOf('y')).toBeGreaterThan(parts.indexOf('then'))
    // 已知代价（研究审计 A04 要让它可见）：runs 是按段分别翻的，整句上下文丢了，
    // 所以这里断言的是"内容与位置"，不是"译文质量"
    expect(node.textContent).toContain('If')
  })

  /** 同一页跑一遍，返回每次请求带了几段 */
  const requestSizes = async (mutate?: Parameters<typeof makeTransport>[0]) => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport, requests } = makeTransport(mutate)
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    return { sizes: requests.map(r => r.request.segments.length), run, doc }
  }

  it('系统性失败不再对半拆：每批只打一次（研究审计 B20 的反例）', async () => {
    // 以前不论哪种失败都拆，一批 N 段会变成 2N-1 次调用（实测 4 段 → `4,2,1,1,2,1,1`）——
    // 同一个失败乘以段数，限额类失败更是反效果。判据由 service 侧随错误送过来
    const base = await requestSizes()
    const systemic = await requestSizes((_req, seg) => (seg.id === 'p1' ? { error: 'bad-request', isolatable: false } : undefined as unknown as string))
    expect(systemic.sizes).toEqual(base.sizes)
    // 整批算失败（这一批里没有一段能成），但仍是可重试的失败块，不是崩溃
    expect(systemic.run.progress().failed).toBeGreaterThan(0)
    expect(systemic.doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
  })

  it('超时不在内容层拆：恢复归队列，两层相乘实测 8 段能扇出 15 次调用', async () => {
    const base = await requestSizes()
    const timedOut = await requestSizes(() => ({ error: 'timeout', isolatable: false }))
    expect(timedOut.sizes).toEqual(base.sizes)
  })

  // Codex 在 #163 指出：一次调用会被拆到多个批次，一批失败不代表另一批没成。
  // service 把成功的那些随失败一起送回来，这一层要渲染出来——否则读者看到"全失败"，
  // 而重试时它们又从缓存里秒回
  it('系统性失败里成功的那些段照样渲染出来，只有真失败的才算失败', async () => {
    const systemic = await requestSizes((_req, seg) => (seg.id === 'p1' ? { error: 'timeout', isolatable: false, partial: true } : undefined as unknown as string))
    // 没有多打一次（系统性失败仍然不拆）
    expect(systemic.sizes).toEqual((await requestSizes()).sizes)
    // p1 失败，同一批里的其他段有译文
    expect(systemic.doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    const others = ['p2', 'p3'].map(id => systemic.doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="${id}"]`))
    expect(others.map(el => el !== null && !el.classList.contains(ERROR_CLASS))).toEqual([true, true])
    expect(systemic.run.progress().failed).toBe(1)
    expect(systemic.doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
  })

  it('某一段引起的失败照旧拆到单段，好的段落照样救回来', async () => {
    const base = await requestSizes()
    const isolatable = await requestSizes((_req, seg) => (seg.id === 'p1' ? { error: 'invalid-response' } : undefined as unknown as string))
    expect(isolatable.sizes.length).toBeGreaterThan(base.sizes.length)
    expect(isolatable.sizes).toContain(1)
    expect(isolatable.run.progress()).toMatchObject({ failed: 1 })
    expect(isolatable.doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    expect(isolatable.doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)?.classList.contains(ERROR_CLASS)).toBe(false)
  })

  it('小部件上的"重试"按钮走同一条重试路径', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    let fail = true
    const { transport } = makeTransport((_req, seg) => (fail && seg.id === 'p1' ? { error: 'network' } : undefined as unknown as string))
    const run = await start(doc, blocks, transport)
    await run.translate([byId(blocks, 'p1')])
    const widget = doc.querySelector(`.${ERROR_CLASS}[${FOR_ATTR}="p1"]`)!
    fail = false
    widget.shadowRoot!.querySelector('button')!.click()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(run.progress()).toMatchObject({ failed: 0, done: 1 })
    expect(doc.querySelector(`.${ERROR_CLASS}`)).toBeNull()
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
    // 旁边只剩失败态小部件，没有译文
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="s1"]`)?.classList.contains(ERROR_CLASS)).toBe(true)
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
    const sibling = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)!
    expect(sibling.classList.contains(ERROR_CLASS)).toBe(true)
    expect(sibling.querySelector('math')).toBeNull()
    expect(doc.querySelectorAll(`.${T_CLASS}[${FOR_ATTR}="p3"]`)).toHaveLength(1)
  })
})

describe('onRendered：每批交出刚动过 DOM 的块（issue #46）', () => {
  it('每批两次：插骨架屏后一次、渲染结果后一次，两次都是这批的块', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport } = makeTransport()
    const seen: Block[][] = []
    const run = await start(doc, blocks, transport, { onRendered: b => seen.push(b) })
    expect(seen).toEqual([]) // 标记阶段不算"渲染"
    const p1 = byId(blocks, blocks[1]!.id)
    await run.translate([p1])
    expect(seen).toHaveLength(2)
    expect(seen[0]).toEqual([p1])
    expect(seen[1]).toEqual([p1])
  })

  it('stop() 之后不再交出', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const transport: Transport = async req => {
      await gate
      return { ok: true, result: { segments: req.request.segments.map(s => ({ id: s.id, text: s.text })), provider: 'mock' }, cached: 0 }
    }
    const seen: Block[][] = []
    const run = await start(doc, blocks, transport, { onRendered: b => seen.push(b) })
    const pending = run.translate([blocks[1]!])
    expect(seen).toHaveLength(1) // 骨架屏那一次已经发出
    run.stop()
    release()
    await pending
    expect(seen).toHaveLength(1) // 结果那一次没有
  })

  it('重试路径同样交出', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    let calls = 0
    const { transport } = makeTransport((_, seg) => (++calls === 1 ? { error: 'network' } : seg.text))
    const seen: Block[][] = []
    const run = await start(doc, blocks, transport, { onRendered: b => seen.push(b) })
    const p1 = blocks[1]!
    await run.translate([p1])
    expect(run.progress().failed).toBe(1)
    expect(seen).toHaveLength(2)
    await run.translate([p1]) // 失败的块可以再交
    expect(seen).toHaveLength(4)
    expect(seen[3]).toEqual([p1])
  })
})

