// 论文级上下文（DESIGN §8.2）：标题与摘要，页面加载时抽一次（那时 DOM 里还没有译文；翻译过再抽会把上一轮的译文也算进摘要），每批 prompt 都带上。
// Read Frog 是多调一次 LLM 给网页生成摘要；论文自带 abstract，直接用。
import { ABSTRACT, DOCUMENT_ROOT, DOCUMENT_TITLE } from '@/core/rules/latexml'

/** 摘要截断长度：每批都要带，太长就是白花 token */
export const ABSTRACT_MAX_CHARS = 1200

export interface PaperContext {
  paperTitle?: string
  abstract?: string
}

/** LaTeXML 的 <math> 里带 <annotation> 存着 TeX 源码，textContent 会把公式读两遍；只取呈现层文字 */
const HIDDEN_MATH_META = new Set(['annotation', 'annotation-xml'])

function text(el: Element | null | undefined): string {
  if (!el) return ''
  const parts: string[] = []
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) parts.push((child as Text).data)
      else if (child.nodeType === 1 && !HIDDEN_MATH_META.has((child as Element).localName)) walk(child)
    }
  }
  walk(el)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max).replace(/\s+\S*$/, '')}...`
}

export function paperContext(doc: Document): PaperContext {
  const root = doc.querySelector(DOCUMENT_ROOT) ?? doc
  const title = text(root.querySelector(DOCUMENT_TITLE))
  const block = root.querySelector(ABSTRACT.root)
  const abstract = block
    ? Array.from(block.children).filter(child => !child.matches(ABSTRACT.title)).map(text).filter(Boolean).join(' ')
    : ''
  return {
    ...(title ? { paperTitle: title } : {}),
    ...(abstract ? { abstract: clip(abstract, ABSTRACT_MAX_CHARS) } : {}),
  }
}
