// 端到端：微软汇报 sentLen → 服务层校验 → 过队列 → 落缓存。
// 每一跳都有单测，但没人验过整条链在真实页面上走得通。
import { chromium } from 'playwright'
import { rmSync } from 'node:fs'
const EXT = process.argv[2]
const PROFILE = '/private/tmp/claude-501/-Users-cheongzhiyan-Developer-ArxivTranslate/6d482bd8-5c21-4216-9edd-225cdeff7f9e/scratchpad/probe-e2e/profile'
rmSync(PROFILE, { recursive: true, force: true })
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1440, height: 900 },
})
let [worker] = ctx.serviceWorkers()
if (!worker) worker = await ctx.waitForEvent('serviceworker')
const extId = worker.url().split('/')[2]

const options = await ctx.newPage()
await options.goto(`chrome-extension://${extId}/options.html`)
await options.selectOption('select >> nth=0', 'microsoft')
// 设置页要显式保存才落 storage（第一版探针漏了这步，于是走了默认的 openai-compat、降级到 Google）
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })

const hosts = new Map()
let firstMs = null
ctx.on('response', async res => {
  const u = new URL(res.url())
  hosts.set(u.hostname, (hosts.get(u.hostname) ?? 0) + 1)
  if (u.hostname === 'edge.microsoft.com' && !firstMs) {
    try { const j = await res.json(); firstMs = { keys: Object.keys(j?.[0]?.translations?.[0] ?? {}), sentLen: j?.[0]?.translations?.[0]?.sentLen } } catch { firstMs = { error: 'no json' } }
  }
})
const logs = []
ctx.on('console', m => { if (m.text().includes('[axt]')) logs.push(m.text().slice(0, 160)) })

const page = await ctx.newPage()
await page.goto('https://arxiv.org/html/2609.04056v1#axt-translate', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(12000)

// 缓存在扩展 origin 的 IndexedDB 里：从扩展页读
const cache = await options.evaluate(async () => {
  const names = await indexedDB.databases()
  const dbName = names.map(d => d.name).find(n => n && /axt|translation|cache/i.test(n))
  if (!dbName) return { error: 'no db', names: names.map(d => d.name) }
  const db = await new Promise((res, rej) => { const r = indexedDB.open(dbName); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const store = [...db.objectStoreNames].find(n => /entr/i.test(n)) ?? db.objectStoreNames[0]
  const all = await new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly').objectStore(store).getAll()
    tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error)
  })
  const withAlign = all.filter(r => r && r.alignment)
  return {
    db: dbName, store, total: all.length,
    withAlignment: withAlign.length,
    sample: withAlign.slice(0, 2).map(r => ({
      srcSentences: r.alignment.source.length,
      tgtSentences: r.alignment.target.length,
      srcSum: r.alignment.source.reduce((a, b) => a + b, 0),
      tgtSum: r.alignment.target.reduce((a, b) => a + b, 0),
      tgtLen: r.translation.length,
      text: r.translation.slice(0, 50),
    })),
  }
})
console.log(JSON.stringify({ cache, hosts: [...hosts].filter(([h]) => !h.includes('arxiv')), firstMs, logs: logs.slice(0, 4) }, null, 2))
await ctx.close()
