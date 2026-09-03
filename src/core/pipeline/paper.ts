/** 从 arxiv.org/html/<id> 取论文 id（含版本号），用作缓存的 paper 字段 */
const HTML_PATH = /^\/html\/(\d{4}\.\d{4,5}(?:v\d+)?)\/?$/

export function paperIdFromUrl(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  return HTML_PATH.exec(url.pathname)?.[1] ?? null
}
