// The toggle in the context menu (issue #146) and on the keyboard command: a second and third entry to the same
// action as the popup's main button — ask the page its state once, decide the way the button does, send what it
// would send.
//
// **The label does not follow the state**: `contextMenus.update` is global, not per tab, and following the current
// page would be wrong the moment the reader switched tabs. Immersive Translate's entry is static too.

import type { PageStatus } from '@/shared/messages'
import { messageFor, pageDecision, type SavedSettings } from '@/shared/page-action'
import { S } from '@/ui/strings'

/** The menu item's id; the old one is removed by it on rebuild, since the worker runs create again on every wake-up */
export const MENU_ID = 'axt-toggle'
/** The same words as the popup's primary button (S-P-50 / S-P-51); also the command's description */
export const menuTitle = (): string => S.page.menuToggle
/** The keyboard command's id, as declared in the manifest (`commands` in wxt.config.ts) */
export const COMMAND_ID = 'axt-toggle'
/** Shown on arXiv's HTML full-text pages only — anywhere else it can do nothing */
export const MENU_PATTERNS = ['https://arxiv.org/html/*']
/**
 * This entry has to be there whatever the right click lands on.
 *
 * Chrome gives the context by **what was clicked**: `link` on a link, `image` on a figure, and `page` only on blank
 * space. A paper page is full of citation links and figures, and with `page` alone registered the easiest places to
 * click would be the ones without the menu (Codex on #147). `documentUrlPatterns` still confines it to arXiv full-text pages
 */
export const MENU_CONTEXTS = ['page', 'selection', 'link', 'image', 'video', 'audio', 'editable']

/** What the toggle needs: a way to ask the page and tell it, and the saved settings' identity (shared/page-action.ts) */
export interface ToggleDeps {
  send<T>(tabId: number, message: { type: string }): Promise<T>
  /** The saved settings as the decision needs them; null when they cannot be read (a running page then restores) */
  saved(): Promise<SavedSettings | null>
}

export interface MenuDeps extends ToggleDeps {
  create(options: { id: string; title: string; contexts: string[]; documentUrlPatterns: string[] }): void
  removeAll(): Promise<void> | void
  onClicked(handler: (info: { menuItemId: string | number }, tab?: { id?: number }) => void): void
}

export interface CommandDeps extends ToggleDeps {
  onCommand(handler: (command: string, tab?: { id?: number }) => void): void
  /** The active tab of the current window, for the platforms that hand the command over without one */
  activeTab(): Promise<{ id?: number } | undefined>
}

/**
 * The toggle itself, shared by the menu and the keyboard command: ask the page its state, decide as the popup's main
 * button does (`pageAction`, shared/page-action.ts — the key does what the button shows) and send the message that
 * button would. A page without a content script yet (just navigated, or the extension updated and the page not
 * reloaded) answers nothing and nothing happens, which is what the popup does in that situation too. The saved
 * settings are read for every toggle: the page's revision against their digest is the "behind" test, so ⌥T on a
 * page left behind by a change in another tab re-translates it, as the button it is badged on offers to
 */
export async function toggleTranslation(deps: ToggleDeps, tabId: number): Promise<void> {
  try {
    const [status, saved] = await Promise.all([
      deps.send<Pick<PageStatus, 'progress' | 'running' | 'epoch'>>(tabId, { type: 'axt:page-status' }),
      deps.saved().catch(() => null),
    ])
    // Settings that could not be read (a build that failed, the status deadline) are not settings that run: a page
    // that is on still restores, nothing else starts — the popup with no configuration disables its button too
    // (Codex on #184)
    const decision = pageDecision(status, saved ?? { revision: null, canRun: false, fallback: false })
    if (decision?.enabled) await deps.send(tabId, messageFor(decision.action, status.epoch))
  } catch {
    // See above
  }
}

/**
 * Install the menu item and its click handler. `removeAll` first: the worker runs this again on every wake-up, and
 * without it the id collides.
 *
 * **The click handler is registered synchronously** (Codex on #161): when the worker is woken by “the menu was
 * clicked”, the event is dispatched right after the script has evaluated, while reading the configuration is a
 * promise — registered inside `.then`, that click would reach no listener and the menu would look dead. So only
 * **the menu's title** waits for the locale pack; the registration does not.
 */
export function installContextMenu(deps: MenuDeps): void {
  deps.onClicked((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return
    void toggleTranslation(deps, tab.id)
  })
  refreshContextMenu(deps)
}

/**
 * Rebuild the menu item with the current locale pack. First at worker start-up (in the fallback language, then once
 * more when the pack has been read), and after that whenever the reader changes the interface language — the worker
 * does not restart for it, and unrebuilt the title would stay in the old language (Codex on #161)
 */
export function refreshContextMenu(deps: MenuDeps): void {
  void Promise.resolve(deps.removeAll()).then(() => {
    deps.create({ id: MENU_ID, title: menuTitle(), contexts: MENU_CONTEXTS, documentUrlPatterns: MENU_PATTERNS })
  })
}

/** The keyboard command (manifest `commands`): the third entry, on the same toggle */
export function installToggleCommand(deps: CommandDeps): void {
  deps.onCommand((command, tab) => {
    if (command !== COMMAND_ID) return
    void (async () => {
      const target = tab?.id !== undefined ? tab : await deps.activeTab().catch(() => undefined)
      if (target?.id !== undefined) await toggleTranslation(deps, target.id)
    })()
  })
}
