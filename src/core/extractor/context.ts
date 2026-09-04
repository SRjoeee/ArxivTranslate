// 论文级上下文（DESIGN §8.2）：标题与摘要，翻译开始时抽一次，每批 prompt 都带上。
// Read Frog 是多调一次 LLM 给网页生成摘要；论文自带 abstract，直接用。
import { ABSTRACT, DOCUMENT_ROOT, DOCUMENT_TITLE } from '@/core/rules/latexml'

/** 摘要截断长度：每批都要带，太长就是白花 token */
export const ABSTRACT_MAX_CHARS = 1200

export interface PaperContext {
  paperTitle?: string
  abstract?: string
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

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
