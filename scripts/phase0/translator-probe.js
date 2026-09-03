// Phase 0 任务 6：探测 Chrome 内置 Translator API。
// 用法：在 https://arxiv.org/html/<id> 页面打开 DevTools 控制台，整段粘贴回车；
// 或作为最小 content script 注入。不要在用户手势之外调用 create()，
// 第二步会分别在"无手势"和"有手势"两种情况下尝试，以确认是否需要用户激活。
(async () => {
  const out = { ua: navigator.userAgent, hasTranslator: 'Translator' in self }
  if (!out.hasTranslator) return console.log(JSON.stringify(out, null, 2))

  const pair = { sourceLanguage: 'en', targetLanguage: 'zh' }
  out.availability = await Translator.availability(pair)   // 'available' | 'downloadable' | 'downloading' | 'unavailable'
  out.userActivation = navigator.userActivation?.isActive ?? 'n/a'

  // 无手势下直接 create：若抛 NotAllowedError 则说明需要用户激活
  try {
    const t0 = performance.now()
    const tr = await Translator.create({
      ...pair,
      monitor(m) { m.addEventListener('downloadprogress', e => console.log('download', e.loaded, '/', e.total ?? '?')) },
    })
    out.createWithoutGesture = 'ok'
    out.createMs = Math.round(performance.now() - t0)
    out.sample = await tr.translate('The proof of Theorem 1 is trivial when the graph is connected.')
    out.sampleHtml = await tr.translate('See <a href="#x">Theorem 1</a> and <em>Lemma 2</em>.') // 是否保留标签
    tr.destroy?.()
  } catch (e) {
    out.createWithoutGesture = `${e.name}: ${e.message}`
  }
  console.log(JSON.stringify(out, null, 2))

  // 若上一步因缺少手势失败，点击页面任意处后会再试一次
  if (out.createWithoutGesture !== 'ok') {
    document.addEventListener('click', async () => {
      try {
        const tr = await Translator.create(pair)
        console.log('create with gesture: ok;', await tr.translate('Hello, world.'))
      } catch (e) { console.log('create with gesture failed:', e.name, e.message) }
    }, { once: true })
    console.log('→ 请点击页面任意位置，以测试有用户手势时的 create()')
  }
})()
