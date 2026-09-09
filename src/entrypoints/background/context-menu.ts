// 右键菜单里的开关（issue #146）。第二个入口，动作与 popup 完全同一条路：问一次状态，
// 然后发 `axt:translate-page` 或 `axt:restore-page`。
//
// **标签不跟着状态变**：`contextMenus.update` 是全局的、不是按标签页的，跟着当前页改的话，
// 一切换标签页就说错了。沉浸式翻译的那一条也是静态的。

import type { PageStatus } from '@/shared/messages'

/** 菜单项 id；重建时按它删旧的，worker 每次唤醒都会重新跑一遍 create */
export const MENU_ID = 'axt-toggle'
/** 与 popup 上那两个按钮同一套说法 */
export const MENU_TITLE = '翻译 / 恢复原文'
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
  return state === 'idle' ? 'axt:translate-page' : 'axt:restore-page'
}

/** 装上菜单项与它的点击处理。`removeAll` 在前：worker 每次唤醒都会再跑一遍，不删会撞 id */
export function installContextMenu(deps: MenuDeps): void {
  void Promise.resolve(deps.removeAll()).then(() => {
    deps.create({ id: MENU_ID, title: MENU_TITLE, contexts: MENU_CONTEXTS, documentUrlPatterns: MENU_PATTERNS })
  })
  deps.onClicked((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return
    const tabId = tab.id
    void (async () => {
      try {
        const status = await deps.send<Pick<PageStatus, 'progress'>>(tabId, { type: 'axt:page-status' })
        const action = actionFor(status)
        if (action) await deps.send(tabId, { type: action })
      } catch {
        // 页面还没装上 content script（刚导航、或扩展刚更新还没刷新）：菜单点了没反应，
        // 与 popup 在同样情况下的表现一致
      }
    })()
  })
}
