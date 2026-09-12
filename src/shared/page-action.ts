import type { PageStatus } from './messages'
import type { ProviderStatus } from '@/providers/transport'

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

/** What the decision is made against: the saved settings' identity and whether they can run */
export interface SavedSettings {
  /** `chainRevision` of the stored configuration; null when unknown — a page is then never behind */
  revision: string | null
  /** The chosen service can run on its own: the popup decides from the settings (`runnable`), the background from the chain's status */
  canRun: boolean
  /** A free engine takes over when it cannot */
  fallback: boolean
}

export interface PageDecision {
  action: PageAction
  behind: boolean
  /** Whether the reader may press it: the popup disables the button, the toggle does nothing */
  enabled: boolean
}

/**
 * The action and whether it is open. A running page always restores. A page behind the settings re-translates only
 * on settings that run on their own — a fallback is not what the reader chose, and the reader is told to fix the
 * choice (popup P13). Anything else starts when something can run, the fallback included (§8.5). The toggle applies
 * this too (the local review of INVENTORY S2): the keyboard command must not restart a page the button refuses to
 */
export function pageDecision(page: Pick<PageStatus, 'progress' | 'running'> | undefined, saved: SavedSettings): PageDecision | undefined {
  const action = pageAction(page, saved.revision)
  if (page === undefined || action === undefined) return undefined
  const behind = behindSettings(page, saved.revision)
  const enabled = action === 'restore' ? true : behind ? saved.canRun : saved.canRun || saved.fallback
  return { action, behind, enabled }
}

/**
 * The saved settings as the background reads them — all three from **one** status of the chain in force, which is
 * built from the stored configuration (`fresh` / `offers`): a revision from one read paired with availability from
 * another could enable what the popup disables (the local review of S2, second pass). `canRun` is the popup's
 * `runnable` seen from the chain: the chosen service resolved to itself (a saved id naming nothing resolves to a
 * built-in) and is available (a language pack present, a key set)
 */
export function savedFromStatus(status: Pick<ProviderStatus, 'revision' | 'available' | 'providerId' | 'chosen' | 'fallback'>): SavedSettings {
  return { revision: status.revision, canRun: status.available && status.providerId === status.chosen, fallback: status.fallback !== undefined }
}

/**
 * The message each action is, the way the popup's buttons send them: a re-translation restarts the session in place.
 * `epoch` is the page's action epoch the decision was made on (`PageStatus.epoch`); the page refuses a command from
 * an earlier epoch — the reader acted in between (sixth and twelfth passes of the local review). Every action
 * carries it, a translate decided on an idle page included: the page may have been translated and restored since
 */
export function messageFor(action: PageAction, epoch?: number): { type: 'axt:translate-page'; restart?: true; epoch?: number } | { type: 'axt:restore-page'; epoch?: number } {
  const decidedOn = epoch !== undefined ? { epoch } : {}
  if (action === 'restore') return { type: 'axt:restore-page', ...decidedOn }
  return action === 'retranslate' ? { type: 'axt:translate-page', restart: true, ...decidedOn } : { type: 'axt:translate-page', ...decidedOn }
}
