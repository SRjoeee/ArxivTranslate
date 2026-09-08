const cands = [
  'Since @0# and @1# , we obtain @2# by @3# , where @4# denotes @5# and @6# is @7# , while @8# remains @9# throughout.',
  'Table @0# and Figure @1# in Section @2# summarise the results for @3# , @4# and @5# .',
  'Let @0# . Then @1# . Hence @2# . Therefore @3# . Finally @4# .',
  'The set @0# contains @1# elements, the set @2# contains @3# elements, and their union @4# contains @5# elements in total.',
  'We write @0# for the map, @1# for its inverse, @2# for the identity, @3# for composition, and @4# for the unit.',
  'In equation @0# we replace @1# by @2# ; in equation @3# we replace @4# by @5# ; the result is @6# .',
]
const ms = async (items) => { const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(items) }); const j = await r.json(); return j.map(x => x.translations[0].text) }
const outs = await ms(cands)
cands.forEach((c, i) => {
  const want = (c.match(/@\d+#/g) || [])
  const got = (outs[i].match(/@\d+#/g) || [])
  const missing = want.filter(m => !got.includes(m))
  console.log((missing.length ? 'LOSS ' : 'ok   ') + '(' + want.length + ' -> ' + got.length + ')' + (missing.length ? '  \u4e22: ' + missing.join(',') : ''))
  if (missing.length) { console.log('   \u9001: ' + c); console.log('   \u56de: ' + outs[i]) }
})
