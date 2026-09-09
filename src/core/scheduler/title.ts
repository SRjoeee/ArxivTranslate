// Tab title translation (DESIGN §10): adapted from Read Frog's document.title handling in page-translation.ts.
// Translate document.title once at startup. Observe <head> and retranslate if the page sets a value different from both the original and our translation.
// Restore the original on stop (§7.1: node-for-node restoration includes <title> text).
// arXiv pages are static, so this rarely fires, but has no meaningful overhead; retain it per CLAUDE.md's porting rule.

export interface TitleTranslator {
  stop(): void
}

export interface TitleOptions {
  /** Translate plain text; return null if unavailable to retain the original title. */
  translate: (text: string) => Promise<string | null>
  /** Whether the session is still current; discard results arriving after it ends. */
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
      // Rejection after session cancellation is expected, not log noise.
      if (request === version && options.isCurrent()) console.warn('[axt] Title translation failed', error)
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
      // The page changed its own title; restore that value rather than ours.
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
