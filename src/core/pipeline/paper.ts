/**
 * Extract the paper ID (including version) from arxiv.org/html/<id> for the cache's paper field.
 * Accept both modern 2410.00260 and legacy hep-th/9901001 / math.GT/0601001 IDs: arXiv generates HTML for old papers too
 * (confirmed 2026-09-05: /html/hep-th/9901001 returns LaTeXML; Codex #9).
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
