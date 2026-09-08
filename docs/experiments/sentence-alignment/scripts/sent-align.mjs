const paras = [
  'Large language models have advanced rapidly. They now solve tasks that once required specialists. However, their reliability remains an open question. We therefore propose a benchmark. It measures calibration under distribution shift.',
  'The algorithm proceeds in two phases. In the first phase we collect candidate invariants. In the second phase we verify them against the model. Verification is the expensive step. We reduce its cost by caching intermediate results.',
  'Our contribution is threefold. First, we formalise the problem. Second, we give an efficient algorithm. Third, we evaluate it on twelve datasets.',
]
function mark(p) { const parts = p.split(/(?<=\.)\s+/); return { text: parts.map((s, i) => i === 0 ? s : '@s' + String.fromCharCode(96 + i) + '# ' + s).join(' '), n: parts.length } }
const ms = async (items) => { const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(items) }); return (await r.json()).map(x => x.translations[0].text) }
const gg = async (items) => { const r = await fetch('https://translate-pa.googleapis.com/v1/translateHtml', { method:'POST', headers:{'Content-Type':'application/json+protobuf','X-Goog-API-Key':'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'}, body: JSON.stringify([[items,'en','zh-CN'],'wt_lib']) }); return (await r.json())[0] }
const marked = paras.map(mark)
for (const [name, fn] of [['\u5fae\u8f6f', ms], ['Google', gg]]) {
  const outs = await fn(marked.map(m => m.text))
  console.log('===== ' + name + ' =====')
  outs.forEach((o, i) => {
    const found = (o.match(/@s[a-z]#/g) || [])
    const want = marked[i].n - 1
    const parts = o.split(/@s[a-z]#/).map(s => s.trim())
    console.log('  \u53e5\u6570 ' + marked[i].n + '\uff0c\u8fb9\u754c\u8bb0\u53f7 ' + want + ' \u2192 \u56de\u6765 ' + found.length + (found.length === want ? '  OK' : '  \u2717'))
    parts.forEach((s, k) => console.log('    [' + k + '] ' + s.slice(0, 70)))
  })
}
