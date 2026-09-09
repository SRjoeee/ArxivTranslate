/** Parse a fragment inside the translation root */
export function docOf(body: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head></head><body><article class="ltx_document">${body}</article></body></html>`,
    'text/html',
  )
}

/** Build a fragment from HTML to simulate rehydrate output */
export function frag(doc: Document, html: string): DocumentFragment {
  const template = doc.createElement('template')
  template.innerHTML = html
  return template.content
}
