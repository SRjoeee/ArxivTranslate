/** 把片段放进翻译根里解析 */
export function docOf(body: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head></head><body><article class="ltx_document">${body}</article></body></html>`,
    'text/html',
  )
}

/** 用 HTML 字符串造一个 fragment（模拟 rehydrate 的输出） */
export function frag(doc: Document, html: string): DocumentFragment {
  const template = doc.createElement('template')
  template.innerHTML = html
  return template.content
}
