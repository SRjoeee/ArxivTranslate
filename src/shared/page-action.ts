import type { PageStatus } from './messages'

// One decision for the popup's main button, the context menu and the keyboard command (INVENTORY S2). The key does
// what the button shows (user 2026-09-11), so the two must not decide separately: they had, and diverged twice — the
// menu restored a page the button offered to re-translate (the page behind the settings), and the button's own
// "behind" test compared the page with the chain it was itself running on, which is never behind.

export type PageAction = 'translate' | 'retranslate' | 'restore'

/**
 * Is the page running on settings other than the saved ones? `savedRevision` is `chainRevision` of the stored
 * configuration; a page records the revision of the chain it started on (`running`). Any change to a chain setting
 * — the service, its key, model or endpoint, the target language, the prompt, the fallback — moves the digest
 */
export function behindSettings(page: Pick<PageStatus, 'progress' | 'running'>, savedRevision: string | null): boolean {
  return page.progress.state === 'on' && page.running !== undefined && savedRevision !== null && page.running.revision !== savedRevision
}

/**
 * Which of the three actions the page calls for. Whether it can be pressed is the popup's business (`runnable`);
 * the toggle just sends it and lets the page refuse. A paused session (a fatal error) retries rather than restores
 * (Codex on #157); a page behind the settings re-translates on them; a running page restores; anything else
 * translates. `undefined` when the page did not answer (no content script yet): nothing to do, not a guess
 */
export function pageAction(page: Pick<PageStatus, 'progress' | 'running'> | undefined, savedRevision: string | null): PageAction | undefined {
  if (page === undefined) return undefined
  const { state, fatal } = page.progress
  if (state === 'on') return behindSettings(page, savedRevision) ? 'retranslate' : 'restore'
  if (state === 'stopped' && fatal !== undefined) return 'retranslate'
  return 'translate'
}

/** The message each action is, the way the popup's buttons send them: a re-translation restarts the session in place */
export function messageFor(action: PageAction): { type: 'axt:translate-page'; restart?: true } | { type: 'axt:restore-page' } {
  if (action === 'restore') return { type: 'axt:restore-page' }
  return action === 'retranslate' ? { type: 'axt:translate-page', restart: true } : { type: 'axt:translate-page' }
}
