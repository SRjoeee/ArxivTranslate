/** 解析按 fixture 真实结构手写的片段，返回 body 的第一个子元素 */
export function el(html: string): Element {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html')
  const target = doc.body.firstElementChild
  if (!target) throw new Error('片段为空')
  return target
}

/** 回填克隆会剥掉 id，比较时把原文的 id 也剥掉 */
export function stripIds(html: string): string {
  return html.replace(/ id="[^"]*"/g, '')
}

/** 把片段挂到 div 里取 innerHTML，便于与原文比较 */
export function htmlOf(fragment: DocumentFragment): string {
  const div = document.createElement('div')
  div.append(fragment)
  return div.innerHTML
}
