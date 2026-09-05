// 标签页标题翻译（DESIGN §10）：Read Frog page-translation.ts 里 document.title 那一段的改写。
// 开始时翻一次 document.title；<head> 上的观察器盯着标题被页面改成"既非原文也非我们写的值"时重翻；
// 停止时恢复原文（§7.1：恢复后逐节点相等，<title> 的文本也要回去）。
// arXiv 页面是静态的，观察器几乎不会触发，但它没有负担，照搬（CLAUDE.md 的搬运判定）。

export interface TitleTranslator {
  stop(): void
}

export interface TitleOptions {
  /** 翻一段纯文本；拿不到译文返回 null（保持原标题） */
  translate: (text: string) => Promise<string | null>
  /** 会话还在不在：结果回来时会话已结束就丢掉 */
  isCurrent: () => boolean
}

export function translateTitle(doc: Document, options: TitleOptions): TitleTranslator {
  let source: string | null = doc.title || ''
  let applied: string | null = null
  let version = 0
  let observer: MutationObserver | null = null

  const sync = async (text: string) => {
    if (!text.trim() || !options.isCurrent()) return
    const request = ++version
    try {
      const translated = await options.translate(text)
      if (!options.isCurrent() || request !== version) return
      const next = translated || text
      applied = next
      if (doc.title !== next) doc.title = next
    } catch (error) {
      // 会话取消后的拒绝是预期的，不算噪音
      if (request === version && options.isCurrent()) console.warn('[axt] 标题翻译失败', error)
    }
  }

  const onMutation = () => {
    if (!options.isCurrent()) return
    const current = doc.title || ''
    if (current === source || current === applied) return
    source = current
    void sync(current)
  }

  if (doc.head && typeof MutationObserver === 'function') {
    observer = new MutationObserver(onMutation)
    observer.observe(doc.head, { childList: true, subtree: true, characterData: true })
  }
  void sync(source)

  return {
    stop() {
      // 页面自己改过标题（不是我们写的）：以它为准恢复
      const current = doc.title || ''
      if (current !== applied) source = current
      observer?.disconnect()
      observer = null
      version++
      if (source !== null && doc.title !== source) doc.title = source
      source = null
      applied = null
    },
  }
}
