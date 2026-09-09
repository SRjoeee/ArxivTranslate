/** Parse a handwritten fragment matching real fixture structure and return the first body child */
export function el(html: string): Element {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html')
  const target = doc.body.firstElementChild
  if (!target) throw new Error('Empty fragment')
  return target
}

/** Rehydration strips clone IDs; strip original IDs too when comparing */
export function stripIds(html: string): string {
  return html.replace(/ id="[^"]*"/g, '')
}

/** Attach the fragment to a div and read innerHTML for comparison with the original */
export function htmlOf(fragment: DocumentFragment): string {
  const div = document.createElement('div')
  div.append(fragment)
  return div.innerHTML
}
