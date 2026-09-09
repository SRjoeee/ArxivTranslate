// 右键菜单里的开关（issue #146）。第二个入口，动作与 popup 完全同一条路：问一次状态，
// 然后发 `axt:translate-page` 或 `axt:restore-page`。
//
// **标签不跟着状态变**：`contextMenus.update` 是全局的、不是按标签页的，跟着当前页改的话，
// 一切换标签页就说错了。沉浸式翻译的那一条也是静态的。

/** 菜单项 id；重建时按它删旧的，worker 每次唤醒都会重新跑一遍 create */
export const MENU_ID = 'axt-toggle'
/** 与 popup 上那两个按钮同一套说法 */
export const MENU_TITLE = '翻译 / 恢复原文'
/** 只在 arXiv 的 HTML 全文页上出现——别的页面上它什么也做不了 */
export const MENU_PATTERNS = ['https://arxiv.org/html/*']

export interface MenuDeps {
  create(options: { id: string; title: string; contexts: string[]; documentUrlPatterns: string[] }): void
  removeAll(): Promise<void> | void
  onClicked(handler: (info: { menuItemId: string | number }, tab?: { id?: number }) => void): void
  send<T>(tabId: number, message: { type: string }): Promise<T>
}

/**
 * 这个状态下该发哪条消息。
 *
 * 纯函数，好测：右键菜单本身在 Playwright 里驱动不了（那是浏览器的原生菜单），
 * 所以「点了之后做什么」这件事只能在这一层钉住。
 */
export function actionFor(status: { progress?: { state?: string } } | undefined): 'axt:translate-page' | 'axt:restore-page' | undefined {
  const state = status?.progress?.state
  if (state === undefined) return undefined
  return state === 'off' ? 'axt:translate-page' : 'axt:restore-page'
}

/** 装上菜单项与它的点击处理。`removeAll` 在前：worker 每次唤醒都会再跑一遍，不删会撞 id */
export function installContextMenu(deps: MenuDeps): void {
  void Promise.resolve(deps.removeAll()).then(() => {
    deps.create({ id: MENU_ID, title: MENU_TITLE, contexts: ['page', 'selection'], documentUrlPatterns: MENU_PATTERNS })
  })
  deps.onClicked((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return
    const tabId = tab.id
    void (async () => {
      try {
        const status = await deps.send<{ progress?: { state?: string } }>(tabId, { type: 'axt:page-status' })
        const action = actionFor(status)
        if (action) await deps.send(tabId, { type: action })
      } catch {
        // 页面还没装上 content script（刚导航、或扩展刚更新还没刷新）：菜单点了没反应，
        // 与 popup 在同样情况下的表现一致
      }
    })()
  })
}
