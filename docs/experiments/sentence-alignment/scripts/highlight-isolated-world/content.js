// 默认世界 = ISOLATED（没有写 "world": "MAIN"）。测的就是隔离世界注册的高亮会不会被页面绘制。
// 主世界与隔离世界的 window 是分开的，所以用 DOM 事件 + <html> 属性通信（document 是共享的）。
(() => {
  const root = document.documentElement
  const api = {
    hasHighlights: typeof CSS !== 'undefined' && 'highlights' in CSS,
    hasHighlight: typeof Highlight !== 'undefined',
    hasCaretPos: typeof document.caretPositionFromPoint === 'function',
  }
  root.setAttribute('data-probe-api', JSON.stringify(api))
  if (!api.hasHighlights || !api.hasHighlight) { root.setAttribute('data-probe', 'unsupported'); return }

  const style = document.createElement('style')
  style.textContent = '::highlight(axt-probe){background-color:#ff00ff;color:#ff00ff}'
  document.head.append(style)

  const target = [...document.querySelectorAll('p.ltx_p')].find(p => (p.textContent || '').length > 200)
  if (!target) { root.setAttribute('data-probe', 'no-target'); return }
  if (!target.id) target.id = 'axt-probe-target'
  const tn = [...target.childNodes].find(n => n.nodeType === 3 && n.data.trim().length > 60)
  if (!tn) { root.setAttribute('data-probe', 'no-text-node'); return }

  document.addEventListener('axt-probe', e => {
    if (e.detail === 'set') {
      const r = new Range(); r.setStart(tn, 0); r.setEnd(tn, Math.min(60, tn.data.length))
      CSS.highlights.set('axt-probe', new Highlight(r))
      root.setAttribute('data-probe-state', 'set:' + CSS.highlights.has('axt-probe') + ':' + JSON.stringify(r.toString().slice(0, 30)))
    } else {
      CSS.highlights.delete('axt-probe')
      root.setAttribute('data-probe-state', 'clear:' + CSS.highlights.has('axt-probe'))
    }
  })
  root.setAttribute('data-probe', 'ready:' + target.id)
})()
