// Phase 0 task 6: probe the Chrome built-in Translator API.
// Usage: paste into DevTools on https://arxiv.org/html/<id>,
// or inject as a minimal content script. Production create() requires a user gesture;
// this probe intentionally tries both without and with a gesture to check activation requirements.
(async () => {
  const out = { ua: navigator.userAgent, hasTranslator: 'Translator' in self }
  if (!out.hasTranslator) return console.log(JSON.stringify(out, null, 2))

  const pair = { sourceLanguage: 'en', targetLanguage: 'zh' }
  out.availability = await Translator.availability(pair)   // 'available' | 'downloadable' | 'downloading' | 'unavailable'
  out.userActivation = navigator.userActivation?.isActive ?? 'n/a'

  // Try create() without a gesture: NotAllowedError indicates activation is required.
  try {
    const t0 = performance.now()
    const tr = await Translator.create({
      ...pair,
      monitor(m) { m.addEventListener('downloadprogress', e => console.log('download', e.loaded, '/', e.total ?? '?')) },
    })
    out.createWithoutGesture = 'ok'
    out.createMs = Math.round(performance.now() - t0)
    out.sample = await tr.translate('The proof of Theorem 1 is trivial when the graph is connected.')
    out.sampleHtml = await tr.translate('See <a href="#x">Theorem 1</a> and <em>Lemma 2</em>.') // Check tag preservation.
    tr.destroy?.()
  } catch (e) {
    out.createWithoutGesture = `${e.name}: ${e.message}`
  }
  console.log(JSON.stringify(out, null, 2))

  // If the first attempt failed without a gesture, retry when the user clicks anywhere on the page.
  if (out.createWithoutGesture !== 'ok') {
    document.addEventListener('click', async () => {
      try {
        const tr = await Translator.create(pair)
        console.log('create with gesture: ok;', await tr.translate('Hello, world.'))
      } catch (e) { console.log('create with gesture failed:', e.name, e.message) }
    }, { once: true })
    console.log('→ Click anywhere on the page to test create() with a user gesture')
  }
})()
