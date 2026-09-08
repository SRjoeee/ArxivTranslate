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

/**
 * 恒等往返的比较口径：两侧都把连续空白折成一个空格再比。
 *
 * `serialize` 从 #119 起在出口折叠空白（LaTeXML 的硬换行会被微软当成句号），所以回填出来的
 * HTML 与原文在**空白数量**上不再逐字节相同。这不是缺陷：回填产生的是译文节点——一个新的兄弟
 * 节点——而 HTML 渲染本来就折叠这些空白；DESIGN §7.1 的「恢复后逐节点相等」由用例末尾那条
 * `outerHTML` 断言守着，`serialize` 纯读、不碰原节点。
 *
 * 放宽的**只有空白数量**这一件事，词间空白**消失**仍然会被抓到：原文折叠后是 `a b`，
 * 若回填成 `ab` 两侧依然不等。`</em> and` 掉成 `</em>and` 同理。
 */
export function sameModuloWhitespace(actual: string, expected: string): [string, string] {
  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()
  return [collapse(actual), collapse(expected)]
}
