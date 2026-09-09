import { describe, expect, it } from 'vitest'
import { extract, type Block } from '@/core/extractor'
import { startTranslation, type Progress, type Transport } from '@/core/pipeline/run'
import { ERROR_CLASS, FOR_ATTR, INLINE_ATTR, PARTIAL_ATTR, PENDING_CLASS, STATE_ATTR, T_CLASS } from '@/core/renderer'
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

/** Identity transport returns input unchanged; mutate can corrupt selected segments */
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

/** Start a session and wait for marking; happy-dom lacks IntersectionObserver, so translate submits blocks explicitly */
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
  it('startup marks without requests; submitted blocks translate in batches with accurate progress and cache counts', async () => {
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
    // One text batch per section plus one table batch
    expect(requests).toHaveLength(3)
    expect(requests[0]?.cache).toEqual({ paper: 'test', renderPath: 'markup' })
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)?.querySelector('math')).not.toBeNull()
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="T1"]`)?.querySelector(TABLE_RULES.cell)?.textContent).toBe('Model')
    expect(doc.documentElement.hasAttribute('data-axt-on')).toBe(true)
  })

  it('translates only submitted blocks; section titles come from the whole-paper map even when the heading is outside the batch (§10)', async () => {
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
    // resubmitting a block skips in-flight work and retries completed work
    await run.translate([byId(blocks, 'p3')])
    expect(requests).toHaveLength(2)
  })

  it('requests insert a pending spinner after the original and count as inFlight; translations replace it on arrival', async () => {
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

  it('one placeholder corruption retries the block with cache writes only and succeeds', async () => {
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

  it('persistent placeholder corruption falls back to runs; requests carry no validation callback because the service infers expectations from input (issue #42)', async () => {
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
    // Requests contain only serializable segments, cache parameters, and scope; validation callbacks cannot cross messaging and are no longer needed.
    expect(Object.keys(markup).sort()).toEqual(['cache', 'request'])
    const node = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)
    expect(node?.querySelector('math')).not.toBeNull()
    expect(node?.textContent).toContain('Two')
  })

  it('batch errors recursively split down to one segment, marking only failed blocks and removing their pending nodes', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    let fail = true
    const { transport } = makeTransport((_req, seg) => (fail && seg.id === 'p1' ? { error: 'unknown' } : undefined as unknown as string))
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    expect(run.progress()).toMatchObject({ failed: 1, done: 5, inFlight: 0 })
    expect(doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    // The failed block has a reason widget (§7.6), not a translation.
    const widget = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)!
    expect(widget.classList.contains(ERROR_CLASS)).toBe(true)
    expect(widget.getAttribute('title')).toBe('unknown: unknown')
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)?.classList.contains(ERROR_CLASS)).toBe(false)
    // failed() returns failed blocks; translate retries them and replaces the widget on success
    expect(run.failed().map(b => b.id)).toEqual(['p1'])
    fail = false
    await run.translate(run.failed())
    expect(run.progress()).toMatchObject({ failed: 0, done: 6 })
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)?.classList.contains(ERROR_CLASS)).toBe(false)
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)?.querySelector('math')).not.toBeNull()
  })

  it('the widget Retry button uses the same retry path', async () => {
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

  it('no-key is fatal: the session stops dispatching new batches', async () => {
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

  it('stop removes pending nodes, discards late translations, and stops progress reports', async () => {
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

  it('forwards scope on every call and omits it when unspecified', async () => {
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

  it('every batch combines paper title and abstract with its section title', async () => {
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

  it('partial tables display successful cells, retain translated state with a partial marker, and count as failed', async () => {
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

  it('a failed short-heading retry removes translation and inline markers; a successful retry restores them', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    await (await start(doc, blocks, makeTransport().transport)).translate(blocks)
    const title = doc.getElementById('s1')!
    expect(title.hasAttribute(INLINE_ATTR)).toBe(true)
    const { transport } = makeTransport((_req, seg) => (seg.id === 's1' ? { error: 'unknown' } : undefined as unknown as string))
    await (await start(doc, blocks, transport)).translate(blocks)
    expect(title.getAttribute(STATE_ATTR)).toBe('failed')
    expect(title.hasAttribute(INLINE_ATTR)).toBe(false)
    // Only the failure widget remains beside the block.
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="s1"]`)?.classList.contains(ERROR_CLASS)).toBe(true)
    await (await start(doc, blocks, makeTransport().transport)).translate(blocks)
    expect(title.hasAttribute(INLINE_ATTR)).toBe(true)
  })

  it('failed retries remove the previous translation so stale output cannot masquerade as the current result', async () => {
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

describe('onRendered receives blocks whose DOM changed in each batch (issue #46)', () => {
  it('Two calls per batch: after inserting spinners and after rendering results, both with that batch of blocks.', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport } = makeTransport()
    const seen: Block[][] = []
    const run = await start(doc, blocks, transport, { onRendered: b => seen.push(b) })
    expect(seen).toEqual([]) // Marking does not count as rendering.
    const p1 = byId(blocks, blocks[1]!.id)
    await run.translate([p1])
    expect(seen).toHaveLength(2)
    expect(seen[0]).toEqual([p1])
    expect(seen[1]).toEqual([p1])
  })

  it('does not emit rendered blocks after stop()', async () => {
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
    expect(seen).toHaveLength(1) // The spinner callback has already fired.
    run.stop()
    release()
    await pending
    expect(seen).toHaveLength(1) // The result callback has not.
  })

  it('the retry path also emits rendered blocks', async () => {
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
    await run.translate([p1]) // Failed blocks can be resubmitted.
    expect(seen).toHaveLength(4)
    expect(seen[3]).toEqual([p1])
  })
})

