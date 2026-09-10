// 右键菜单里的开关（issue #146）。第二个入口，动作与 popup 完全同一条路：问一次状态，
// 然后发 `axt:translate-page` 或 `axt:restore-page`。
//
// **标签不跟着状态变**：`contextMenus.update` 是全局的、不是按标签页的，跟着当前页改的话，
// 一切换标签页就说错了。沉浸式翻译的那一条也是静态的。

import type { PageStatus } from '@/shared/messages'
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

export interface MenuDeps {
  create(options: { id: string; title: string; contexts: string[]; documentUrlPatterns: string[] }): void
  removeAll(): Promise<void> | void
  onClicked(handler: (info: { menuItemId: string | number }, tab?: { id?: number }) => void): void
  send<T>(tabId: number, message: { type: string }): Promise<T>
}

export interface CommandDeps {
  onCommand(handler: (command: string, tab?: { id?: number }) => void): void
  /** The active tab of the current window, for the platforms that hand the command over without one */
  activeTab(): Promise<{ id?: number } | undefined>
  send<T>(tabId: number, message: { type: string }): Promise<T>
}

/**
 * 这个状态下该发哪条消息。
 *
 * **参数按 `PageStatus` 定型，不是随手一个宽松对象。** 第一版写的是 `state === 'off'`，而
 * `Progress.state` 只有 `idle | on | stopped` 三个值——菜单于是永远发恢复、一次都没能开始翻译过，
 * 而测试里那个假状态也写着 `'off'`，正好把它盖住了（Codex 在 #147 指出）。定了型，这种假样例编译不过。
 *
 * 分界与 popup 的两个按钮一致：`canRestore` 是 `state !== 'idle'`，所以只有 idle 才是「去翻」。
 *
 * 纯函数，好测：右键菜单本身在 Playwright 里驱动不了（那是浏览器的原生菜单），
 * 所以「点了之后做什么」这件事只能在这一层钉住。
 */
export function actionFor(status: Pick<PageStatus, 'progress'> | undefined): 'axt:translate-page' | 'axt:restore-page' | undefined {
  const state = status?.progress?.state
  if (state === undefined) return undefined
  // A paused session (a fatal error) retries, matching the popup's 重新翻译 — the shortcut badge sits
  // on that very button, so restoring here would undo the translations the reader asked to retry
  // (Codex on #157). Only a running one restores
  if (state === 'stopped' && status?.progress?.fatal !== undefined) return 'axt:translate-page'
  return state === 'idle' ? 'axt:translate-page' : 'axt:restore-page'
}

/**
 * The toggle itself, shared by the menu and the keyboard command: ask the page its state, then send
 * the same message the popup's button would. A page without a content script yet (just navigated,
 * or the extension updated and the page not reloaded) answers nothing and nothing happens, which
 * is what the popup does in that situation too
 */
export async function toggleTranslation(send: MenuDeps['send'], tabId: number): Promise<void> {
  try {
    const status = await send<Pick<PageStatus, 'progress'>>(tabId, { type: 'axt:page-status' })
    const action = actionFor(status)
    if (action) await send(tabId, { type: action })
  } catch {
    // See above
  }
}

/** 装上菜单项与它的点击处理。`removeAll` 在前：worker 每次唤醒都会再跑一遍，不删会撞 id */
export function installContextMenu(deps: MenuDeps): void {
  void Promise.resolve(deps.removeAll()).then(() => {
    deps.create({ id: MENU_ID, title: menuTitle(), contexts: MENU_CONTEXTS, documentUrlPatterns: MENU_PATTERNS })
  })
  deps.onClicked((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return
    void toggleTranslation(deps.send, tab.id)
  })
}

/** The keyboard command (manifest `commands`): the third entry, on the same toggle */
export function installToggleCommand(deps: CommandDeps): void {
  deps.onCommand((command, tab) => {
    if (command !== COMMAND_ID) return
    void (async () => {
      const target = tab?.id !== undefined ? tab : await deps.activeTab().catch(() => undefined)
      if (target?.id !== undefined) await toggleTranslation(deps.send, target.id)
    })()
  })
}
