const cases = [
  'We assume that each of the sequential processes involved in the computation is deterministic,\nand the only source of nondeterminism is context switches due to an external scheduler.',
  'Unless stated otherwise, the numerical examples use a fixed random\nseed. The distributed reproduction package generates every table and\nfigure from the corresponding input and output data.',
  'Possible extensions include variable coefficients, transcendental\nfield nonlinearities, products of more than four factors, and\nvectorized or parallel batches.',
]
const ms = async (items) => { const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(items) }); return (await r.json()).map(x => x.translations[0].text) }
const raw = await ms(cases)
const norm = await ms(cases.map(c => c.replace(/\s+/g, ' ').trim()))
cases.forEach((_, i) => {
  console.log('--- ' + (i + 1) + ' ---')
  console.log('  \u5e26\u6362\u884c: ' + raw[i])
  console.log('  \u5f52\u4e00\u5316: ' + norm[i])
})
