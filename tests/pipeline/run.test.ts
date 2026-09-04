import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { runTranslation, type Transport } from '@/core/pipeline/run'
import { FOR_ATTR, STATE_ATTR, T_CLASS } from '@/core/renderer'
import { TABLE_RULES } from '@/core/rules/latexml'
import type { TranslateMessageRequest } from '@/entrypoints/background/translate-handler'

const PAGE =
  '<p class="ltx_p" id="p1">One <math class="ltx_Math"><mi>x</mi></math>.</p>'
  + '<p class="ltx_p" id="p2">Two <math class="ltx_Math"><mi>y</mi></math> here.</p>'
  + '<p class="ltx_p" id="p3">Three.</p>'
  + '<table class="ltx_tabular" id="T1"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table>'

const docOf = () => new DOMParser().parseFromString(`<!doctype html><html><head></head><body><article class="ltx_document">${PAGE}</article></body></html>`, 'text/html')

/** 恒等 transport：原样返回；可用 mutate 篡改某些段 */
function makeTransport(mutate?: (req: TranslateMessageRequest, seg: { id: string; text: string }, calls: number) => string | { error: string }) {
  const requests: TranslateMessageRequest[] = []
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
    expect(requests.some(r => r.request.segments.length === 1 && r.request.segments[0]?.id === 'p2')).toBe(true)
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
})
