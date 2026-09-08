// Google 的 translateHtml 能不能承载句边界标签？三个指标分开报，不合成一个数字。
// 源句边界取自微软 sentLen（issue #105 已实测：60/60 句数相等、118 个记号无损），当分词器用。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/extractor'
import { serialize } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/serialize'

const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// —— 取真实块（与 baseline.mts 同一套口径）——
const all: string[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window()
  win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const p = serialize(b.el as never)
    if (p.slots.size === 0) continue
    const flat = p.text.replace(/<t id="\d+">/g, '').replace(/<\/t>/g, '')
    const bare = flat.replace(/<x id="\d+"\/>/g, '')
    if (bare.trim().length < 80 || flat.length > 2000) continue
    all.push(flat.replace(/\s+/g, ' ').trim())   // 归一化空白：不归一化的话微软会在硬换行处断句（README 第四节）
  }
  win.close()
}
const N = Number(process.env.N ?? 60)
const pick = Array.from({ length: N }, (_, i) => all[Math.floor((i / N) * all.length)]!)

const msSent = async (items: string[]) => {
  const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) })
  if (!r.ok) throw new Error('ms ' + r.status)
  return await r.json() as Array<{ translations: Array<{ text: string; sentLen?: { srcSentLen: number[] } }> }>
}
const google = async (items: string[]) => {
  const r = await fetch('https://translate-pa.googleapis.com/v1/translateHtml', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520' },
    body: JSON.stringify([[items, 'en', 'zh-CN'], 'wt_lib']),
  })
  if (!r.ok) throw new Error('google ' + r.status)
  return (await r.json() as string[][])[0]!
}

// —— 用微软的 srcSentLen 切源句 ——
const sents: string[][] = []
for (let i = 0; i < pick.length; i += 20) {
  const chunk = pick.slice(i, i + 20)
  const res = await msSent(chunk)
  chunk.forEach((text, k) => {
    const lens = res[k]?.translations[0]?.sentLen?.srcSentLen
    if (!lens || lens.length < 2) { sents.push([text]); return }
    const out: string[] = []; let at = 0
    for (const L of lens) { out.push(text.slice(at, at + L)); at += L }
    if (at < text.length) out[out.length - 1] += text.slice(at)   // 尾部空白夹到末段
    sents.push(out)
  })
  await sleep(400)
}

const TAGS = (process.env.TAGS ?? 'y,s').split(',')
for (const tag of TAGS) {
  const mk = (n: number) => `<${tag} id="${n}"/>`
  const multi = pick.map((_, i) => i).filter(i => sents[i]!.length >= 2)
  const tagged = multi.map(i => sents[i]!.map((s, k) => mk(k) + s).join(''))
  // 对照组：同样的块，不插句标签
  const plainSrc = multi.map(i => pick[i]!)

  const outTagged: string[] = []; const outPlain: string[] = []
  for (let i = 0; i < tagged.length; i += 20) { outTagged.push(...await google(tagged.slice(i, i + 20))); await sleep(400) }
  for (let i = 0; i < plainSrc.length; i += 20) { outPlain.push(...await google(plainSrc.slice(i, i + 20))); await sleep(400) }

  let survived = 0, ordered = 0, assignOK = 0, assignTotal = 0, assignBlocks = 0, assignBlocksOK = 0, identical = 0
  const bad: string[] = []
  multi.forEach((srcIdx, k) => {
    const n = sents[srcIdx]!.length
    const out = outTagged[k]!
    const found = [...out.matchAll(new RegExp(`<${tag} id="(\\d+)"\\s*/>`, 'g'))].map(m => Number(m[1]))
    const counts = new Map<number, number>(); for (const id of found) counts.set(id, (counts.get(id) ?? 0) + 1)
    const allOnce = counts.size === n && [...counts.values()].every(v => v === 1)
    if (allOnce) survived++
    const inOrder = allOnce && found.every((id, i) => id === i)
    if (inOrder) ordered++

    // 指标三：占位符落到正确的句段（顺序敏感、客观）
    if (inOrder) {
      const segs: string[] = []
      const parts = out.split(new RegExp(`<${tag} id="\\d+"\\s*/>`))
      for (let i = 1; i < parts.length; i++) segs.push(parts[i]!)
      let blockOK = true, blockHas = false
      sents[srcIdx]!.forEach((s, si) => {
        for (const m of s.matchAll(/<x id="(\d+)"\/>/g)) {
          assignTotal++; blockHas = true
          if (segs[si]?.includes(`<x id="${m[1]}"/>`)) assignOK++
          else { blockOK = false; if (bad.length < 4) bad.push(`  块#${srcIdx} 句${si} 的 <x id="${m[1]}"/> 跑到别处`) }
        }
      })
      if (blockHas) { assignBlocks++; if (blockOK) assignBlocksOK++ }
    }
    // 指标四：插标签有没有改变译文本身（去掉标签后逐字比较，顺序敏感）
    if (out.replace(new RegExp(`<${tag} id="\\d+"\\s*/>`, 'g'), '').replace(/\s+/g, '') === outPlain[k]!.replace(/\s+/g, '')) identical++
  })
  console.log(`\n=== <${tag} id="N"/> ===  ${multi.length} 个多句块，共 ${multi.reduce((a, i) => a + sents[i]!.length, 0)} 句`)
  console.log(`  标签存活（每个恰好一次）  ${survived}/${multi.length}`)
  console.log(`  顺序正确（0,1,2,…）      ${ordered}/${multi.length}`)
  console.log(`  占位符落到正确句段        ${assignOK}/${assignTotal} 个 · ${assignBlocksOK}/${assignBlocks} 块`)
  console.log(`  译文与不插标签时逐字相同  ${identical}/${multi.length}`)
  if (bad.length) console.log(bad.join('\n'))
}
