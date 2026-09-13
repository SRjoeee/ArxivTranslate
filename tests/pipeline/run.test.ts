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

/** An identity transport: returns as it was; mutate can tamper with some segments */
function makeTransport(mutate?: (req: TranslateCall, seg: { id: string; text: string }, calls: number) => string | { error: string; isolatable?: boolean; partial?: boolean }) {
  const requests: TranslateCall[] = []
  const transport: Transport = async req => {
    requests.push(req)
    const segments: { id: string; text: string }[] = []
    for (const seg of req.request.segments) {
      const out = mutate?.(req, seg, requests.length)
      // Counted as “caused by one segment” by default: on a batch error translateSegments halves down to single segments,
      // and the existing cases rely on that path to mark only the block that really failed. Systemic failures have cases passing isolatable: false explicitly
      if (out && typeof out === 'object') {
        // partial: the segments another batch of this call had translated already come back with the failure (§8.2)
        const partial = out.partial ? req.request.segments.filter(s => s.id !== seg.id).map(s => ({ id: s.id, text: s.text })) : undefined
        return { ok: false, error: { kind: out.error as 'unknown', message: out.error, isolatable: out.isolatable ?? true }, ...(partial && partial.length > 0 ? { partial } : {}) }
      }
      segments.push({ id: seg.id, text: typeof out === 'string' ? out : seg.text })
    }
    return { ok: true, result: { segments, provider: 'mock' }, cached: 1 }
  }
  return { transport, requests }
}

/** Start a session and wait for the marking; happy-dom has no IntersectionObserver, so blocks are handed over by translate by hand */
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

  it('starting only marks and sends no request; blocks handed over are batched and translated, the progress and cache counts right', async () => {
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
    // One text batch per section + one table batch
    expect(requests).toHaveLength(3)
    expect(requests[0]?.cache).toEqual({ paper: 'test', renderPath: 'tags' })
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)?.querySelector('math')).not.toBeNull()
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="T1"]`)?.querySelector(TABLE_RULES.cell)?.textContent).toBe('Model')
    expect(doc.documentElement.hasAttribute('data-axt-on')).toBe(true)
  })

  it('only blocks handed over are translated; section headings come from the table computed for the whole paper at the start, headings outside this batch count too (§10)', async () => {
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
    // The same block handed over again: skipped while in flight, translated again as a retry once done
    await run.translate([byId(blocks, 'p3')])
    expect(requests).toHaveLength(2)
  })

  it('during the request the original block is followed by a pending node with a skeleton, counted inFlight in the progress; replaced when the translation arrives', async () => {
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

  it('placeholders damaged once: the single block is resent (cache write only, no read) and succeeds', async () => {
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

  it('placeholders always damaged: the runs fallback; the request no longer carries a validation callback (issue #42: the service derives it from the request text)', async () => {
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
    // The request carries only what travels: segments, cache parameters, scope. A validation callback cannot cross the message boundary and is no longer needed
    expect(Object.keys(tags).sort()).toEqual(['cache', 'request'])
    const node = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)
    expect(node?.querySelector('math')).not.toBeNull()
    expect(node?.textContent).toContain('Two')
  })

  it('a batch error: halved down to single segments, only the blocks that really failed are marked, their pending removed', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    let fail = true
    const { transport } = makeTransport((_req, seg) => (fail && seg.id === 'p1' ? { error: 'unknown' } : undefined as unknown as string))
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    expect(run.progress()).toMatchObject({ failed: 1, done: 5, inFlight: 0 })
    expect(doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    // Next to a failed block is the widget with the reason (§7.6), not a translation
    const widget = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)!
    expect(widget.classList.contains(ERROR_CLASS)).toBe(true)
    // Hovering shows the sentence in the interface language; the raw diagnostic is in the attribute (Codex on #161)
    expect(widget.getAttribute('title')).toBe(reasonText('unknown'))
    expect(widget.getAttribute('data-axt-reason')).toBe('unknown: unknown')
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)?.classList.contains(ERROR_CLASS)).toBe(false)
    // failed() lists the failed blocks; handing them to translate again is a retry, and on success the widget is replaced by the translation
    expect(run.failed().map(b => b.id)).toEqual(['p1'])
    fail = false
    await run.translate(run.failed())
    expect(run.progress()).toMatchObject({ failed: 0, done: 6 })
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)?.classList.contains(ERROR_CLASS)).toBe(false)
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p1"]`)?.querySelector('math')).not.toBeNull()
  })

  it('a lost placeholder does not move the formula to the end of the sentence: each clause keeps its own (the acceptance criterion of research audit F03)', async () => {
    // Read Frog's fallback **appends lost formulas at the end of the translation** — with two clauses and two formulas in one sentence,
    // which belongs to which half is gone. Our runs fallback reassembles by position, so the position can be asserted
    const page = '<p class="ltx_p" id="two">If <math class="ltx_Math"><mi>x</mi></math> is positive then '
      + '<math class="ltx_Math"><mi>y</mi></math> is negative.</p>'
    const doc = docOf(page)
    const blocks = extract(doc)
    const { transport } = makeTransport((req, seg) => (seg.id === 'two' && req.cache?.renderPath === 'tags' ? '占位符全丢了' : undefined as unknown as string))
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    const node = doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="two"]`)!
    expect(node.querySelectorAll('math')).toHaveLength(2)
    // The two formulas still sit inside their own halves: x inside "If … is positive", y inside "then … is negative"
    const parts = Array.from(node.childNodes).map(n => n.nodeType === 1 ? (n as Element).textContent : n.textContent).join('|')
    expect(parts.indexOf('x')).toBeGreaterThan(parts.indexOf('If'))
    expect(parts.indexOf('x')).toBeLessThan(parts.indexOf('then'))
    expect(parts.indexOf('y')).toBeGreaterThan(parts.indexOf('then'))
    // The known cost (research audit A04 wants it visible): runs are translated run by run and the sentence context is lost,
    // so what is asserted here is “content and position”, not “translation quality”
    expect(node.textContent).toContain('If')
  })

  /** Run the same page once; returns how many segments each request carried */
  const requestSizes = async (mutate?: Parameters<typeof makeTransport>[0]) => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport, requests } = makeTransport(mutate)
    const run = await start(doc, blocks, transport)
    await run.translate(blocks)
    return { sizes: requests.map(r => r.request.segments.length), run, doc }
  }

  it('a systemic failure is no longer halved: one call per batch (the counter-example of research audit B20)', async () => {
    // Every kind of failure used to be split, and a batch of N segments became 2N-1 calls (measured: 4 segments → `4,2,1,1,2,1,1`) —
    // the same failure multiplied by the segment count, counter-productive for quota failures above all. The criterion comes from the service side with the error
    const base = await requestSizes()
    const systemic = await requestSizes((_req, seg) => (seg.id === 'p1' ? { error: 'bad-request', isolatable: false } : undefined as unknown as string))
    expect(systemic.sizes).toEqual(base.sizes)
    // The whole batch counts as failed (no segment of it could succeed), but as retryable failed blocks, not a crash
    expect(systemic.run.progress().failed).toBeGreaterThan(0)
    expect(systemic.doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
  })

  it('a timeout is not split at the content layer: recovery belongs to the queue; the two layers multiplied, measured 8 segments fanning out into 15 calls', async () => {
    const base = await requestSizes()
    const timedOut = await requestSizes(() => ({ error: 'timeout', isolatable: false }))
    expect(timedOut.sizes).toEqual(base.sizes)
  })

  // Codex on #163: one call is split across several batches, and one batch failing does not mean another did not succeed.
  // The service sends the successful ones back with the failure, and this layer has to render them — or the reader sees “all failed”
  // while on retry they come back from the cache in an instant
  it('the segments that succeeded inside a systemic failure are rendered all the same; only the ones that really failed count as failed', async () => {
    const systemic = await requestSizes((_req, seg) => (seg.id === 'p1' ? { error: 'timeout', isolatable: false, partial: true } : undefined as unknown as string))
    // No extra call (a systemic failure is still not split)
    expect(systemic.sizes).toEqual((await requestSizes()).sizes)
    // p1 failed, the other segments of the same batch have translations
    expect(systemic.doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    const others = ['p2', 'p3'].map(id => systemic.doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="${id}"]`))
    expect(others.map(el => el !== null && !el.classList.contains(ERROR_CLASS))).toEqual([true, true])
    expect(systemic.run.progress().failed).toBe(1)
    expect(systemic.doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
  })

  it('a failure caused by one segment is still split down to single segments, the good ones rescued as before', async () => {
    const base = await requestSizes()
    const isolatable = await requestSizes((_req, seg) => (seg.id === 'p1' ? { error: 'invalid-response' } : undefined as unknown as string))
    expect(isolatable.sizes.length).toBeGreaterThan(base.sizes.length)
    expect(isolatable.sizes).toContain(1)
    expect(isolatable.run.progress()).toMatchObject({ failed: 1 })
    expect(isolatable.doc.getElementById('p1')?.getAttribute(STATE_ATTR)).toBe('failed')
    expect(isolatable.doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="p2"]`)?.classList.contains(ERROR_CLASS)).toBe(false)
  })

  it('the Retry button on the widget takes the same retry path', async () => {
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

  it('no-key: after a fatal error the session stops and sends no new batch', async () => {
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

  it('stop: pending removed, translations arriving afterwards not rendered, progress no longer reported', async () => {
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

  it('the cancel scope is passed to every call; absent when not given', async () => {
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

  it('the paper-level context (title, abstract) goes with every batch, merged with the batch\'s section heading', async () => {
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

  it('a table half translated: the cells translated show as usual, the source table stays translated plus a partial mark, counted failed', async () => {
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

  it('a short heading failing on retranslation: the inline mark is removed with the translation; added back on success', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    await (await start(doc, blocks, makeTransport().transport)).translate(blocks)
    const title = doc.getElementById('s1')!
    expect(title.hasAttribute(INLINE_ATTR)).toBe(true)
    const { transport } = makeTransport((_req, seg) => (seg.id === 's1' ? { error: 'unknown' } : undefined as unknown as string))
    await (await start(doc, blocks, transport)).translate(blocks)
    expect(title.getAttribute(STATE_ATTR)).toBe('failed')
    expect(title.hasAttribute(INLINE_ATTR)).toBe(false)
    // Beside it only the failure widget remains, no translation
    expect(doc.querySelector(`.${T_CLASS}[${FOR_ATTR}="s1"]`)?.classList.contains(ERROR_CLASS)).toBe(true)
    await (await start(doc, blocks, makeTransport().transport)).translate(blocks)
    expect(title.hasAttribute(INLINE_ATTR)).toBe(true)
  })

  it('a block failing on retranslation has to delete the previous round\'s translation, not leave the old one posing as this round\'s', async () => {
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

describe('onRendered: hands over the blocks whose DOM just changed, once per batch (issue #46)', () => {
  it('twice per batch: once after the skeletons are inserted, once after the results are rendered, both with this batch\'s blocks', async () => {
    const doc = docOf()
    const blocks = extract(doc)
    const { transport } = makeTransport()
    const seen: Block[][] = []
    const run = await start(doc, blocks, transport, { onRendered: b => seen.push(b) })
    expect(seen).toEqual([]) // the marking phase does not count as “rendering”
    const p1 = byId(blocks, blocks[1]!.id)
    await run.translate([p1])
    expect(seen).toHaveLength(2)
    expect(seen[0]).toEqual([p1])
    expect(seen[1]).toEqual([p1])
  })

  it('after stop() nothing more is handed over', async () => {
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
    expect(seen).toHaveLength(1) // the skeleton one was already issued
    run.stop()
    release()
    await pending
    expect(seen).toHaveLength(1) // the result one did not come
  })

  it('the retry path hands over too', async () => {
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
    await run.translate([p1]) // a failed block can be handed over again
    expect(seen).toHaveLength(4)
    expect(seen[3]).toEqual([p1])
  })
})

