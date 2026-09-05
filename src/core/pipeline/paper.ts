/**
 * 从 arxiv.org/html/<id> 取论文 id（含版本号），用作缓存的 paper 字段。
 * 新式 2410.00260 与旧式 hep-th/9901001、math.GT/0601001 都收：arXiv 已为旧文生成 HTML
 *（2026-09-05 实测 /html/hep-th/9901001 返回 LaTeXML 页面；Codex 在 #9 指出）
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
