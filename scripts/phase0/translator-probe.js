// Phase 0 task 6: probing Chrome's built-in Translator API.
// Usage: on an https://arxiv.org/html/<id> page open the DevTools console, paste the whole file and press Enter;
// or inject it as a minimal content script. Do not call create() outside a user gesture:
// step two tries both “without a gesture” and “with a gesture” to confirm whether user activation is needed.
(async () => {
  const out = { ua: navigator.userAgent, hasTranslator: 'Translator' in self }
  if (!out.hasTranslator) return console.log(JSON.stringify(out, null, 2))

  const pair = { sourceLanguage: 'en', targetLanguage: 'zh' }
  out.availability = await Translator.availability(pair)   // 'available' | 'downloadable' | 'downloading' | 'unavailable'
  out.userActivation = navigator.userActivation?.isActive ?? 'n/a'

  // create() without a gesture: a NotAllowedError means user activation is needed
  try {
    const t0 = performance.now()
    const tr = await Translator.create({
      ...pair,
      monitor(m) { m.addEventListener('downloadprogress', e => console.log('download', e.loaded, '/', e.total ?? '?')) },
    })
    out.createWithoutGesture = 'ok'
    out.createMs = Math.round(performance.now() - t0)
    out.sample = await tr.translate('The proof of Theorem 1 is trivial when the graph is connected.')
    out.sampleHtml = await tr.translate('See <a href="#x">Theorem 1</a> and <em>Lemma 2</em>.') // // whether tags are preserved
    tr.destroy?.()
  } catch (e) {
    out.createWithoutGesture = `${e.name}: ${e.message}`
  }
  console.log(JSON.stringify(out, null, 2))

  // If the previous step failed for lack of a gesture, it is tried once more after a click anywhere on the page
  if (out.createWithoutGesture !== 'ok') {
    document.addEventListener('click', async () => {
      try {
        const tr = await Translator.create(pair)
        console.log('create with gesture: ok;', await tr.translate('Hello, world.'))
      } catch (e) { console.log('create with gesture failed:', e.name, e.message) }
    }, { once: true })
    console.log('→ click anywhere on the page to test create() with a user gesture')
  }
})()
