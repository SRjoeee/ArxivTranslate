// Ported from reference/read-frog/src/entrypoints/host.content/translation-control/page-translation.ts@9b44f82 (GPL-3.0),
// 2026-09-05, modified: only its document.title part, rewritten around this project's session and transport (DESIGN §10).
// document.title is translated once at the start; an observer on <head> watches for the page changing the title to
// “neither the original nor the value we wrote” and translates again; on stop the original is restored (§7.1: equal
// node by node after restore, the <title> text included). arXiv pages are static and the observer almost never
// fires, but it costs nothing, so it was ported as it was (CLAUDE.md's porting rule).

export interface TitleTranslator {
  stop(): void
}

export interface TitleOptions {
  /** Translate a run of plain text; null when no translation could be had (the original title stays) */
  translate: (text: string) => Promise<string | null>
  /** Is the session still there: a result arriving after the session ended is dropped */
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
      // A rejection after the session was cancelled is expected, not noise
      if (request === version && options.isCurrent()) console.warn('[axt] title translation failed', error)
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
      // The page changed the title itself (not our write): restore to that
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
