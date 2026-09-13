/**
 * The paper id (version included) out of arxiv.org/html/<id>, used as the cache's paper field.
 * The new form 2410.00260 and the old hep-th/9901001, math.GT/0601001 are both accepted: arXiv has generated HTML for
 * old papers (measured 2026-09-05: /html/hep-th/9901001 returns a LaTeXML page; Codex on #9)
 */
const HTML_PATH = /^\/html\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Za-z-]+)?\/\d{7}(?:v\d+)?)\/?$/

export function paperIdFromUrl(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  return HTML_PATH.exec(url.pathname)?.[1] ?? null
}
