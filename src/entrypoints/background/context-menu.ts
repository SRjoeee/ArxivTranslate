// The toggle in the context menu (issue #146) and on the keyboard command: a second and third entry to the same
// action as the popup's main button — ask the page its state once, decide the way the button does, send what it
// would send.
//
// **标签不跟着状态变**：`contextMenus.update` 是全局的、不是按标签页的，跟着当前页改的话，
// 一切换标签页就说错了。沉浸式翻译的那一条也是静态的。

import type { PageStatus } from '@/shared/messages'
import { messageFor, pageDecision, type SavedSettings } from '@/shared/page-action'
import { S } from '@/ui/strings'

/** 菜单项 id；重建时按它删旧的，worker 每次唤醒都会重新跑一遍 create */
export const MENU_ID = 'axt-toggle'
/** The same words as the popup's primary button (S-P-50 / S-P-51); also the command's description */
export const menuTitle = (): string => S.page.menuToggle
/** The keyboard command's id, as declared in the manifest (`commands` in wxt.config.ts) */
export const COMMAND_ID = 'axt-toggle'
/** 只在 arXiv 的 HTML 全文页上出现——别的页面上它什么也做不了 */
export const MENU_PATTERNS = ['https://arxiv.org/html/*']
/**
 * 右键点在什么上都要有这一条。
 *
 * Chrome 是按**点中的目标**给 context 的：点在链接上给 `link`、点在图上给 `image`，`page` 只在
 * 点空白处才给。论文页里到处是引用链接和插图，只注册 `page` 的话，最容易点到的地方反而没有菜单
 *（Codex 在 #147 指出）。`documentUrlPatterns` 仍然把范围锁在 arXiv 全文页
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
 * 装上菜单项与它的点击处理。`removeAll` 在前：worker 每次唤醒都会再跑一遍，不删会撞 id。
 *
 * **点击处理是同步注册的**（Codex 在 #161 指出）：worker 被「点了菜单」这件事唤醒时，事件在脚本求值
 * 之后就派发，而读配置是个 promise——把注册放进 `.then` 里，那一次点击就落不到任何监听器上，菜单
 * 看起来毫无反应。所以只有**菜单的标题**等语言包，注册不等。
 */
export function installContextMenu(deps: MenuDeps): void {
  deps.onClicked((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return
    void toggleTranslation(deps, tab.id)
  })
  refreshContextMenu(deps)
}

/**
 * 用当前语言包重建菜单项。第一次在 worker 启动时（先用兜底语言，语言包读到之后再来一次），
 * 之后每次读者改界面语言时——worker 不会因为这个重启，不重建的话标题会一直停在旧语言（Codex 在 #161 指出）
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
