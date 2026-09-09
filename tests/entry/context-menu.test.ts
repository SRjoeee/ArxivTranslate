import { describe, expect, it, vi } from 'vitest'
import { MENU_CONTEXTS, MENU_ID, MENU_PATTERNS, MENU_TITLE, actionFor, installContextMenu } from '@/entrypoints/background/context-menu'
import type { Progress } from '@/core/pipeline/run'

/** 真实形状的进度：第一版这里写的是随手编的 `{ state: 'off' }`，而 `Progress` 根本没有这个值，
 *  于是「菜单永远发恢复、一次都开始不了翻译」这个 bug 被测试盖住了（Codex 在 #147 指出） */
const progress = (state: Progress['state']): { progress: Progress } =>
  ({ progress: { state, total: 10, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0 } })

// 右键菜单的开关（issue #146）。原生右键菜单在 Playwright 里驱动不了，所以「点了之后做什么」
// 只能在这一层钉住
function fakeMenu(status?: { progress: Progress }) {
  const sent: { tabId: number; type: string }[] = []
  const created: unknown[] = []
  let click: ((info: { menuItemId: string | number }, tab?: { id?: number }) => void) | undefined
  const deps = {
    create: (o: { id: string; title: string; contexts: string[]; documentUrlPatterns: string[] }) => { created.push(o) },
    removeAll: () => Promise.resolve(),
    onClicked: (h: (info: { menuItemId: string | number }, tab?: { id?: number }) => void) => { click = h },
    send: vi.fn(async (tabId: number, message: { type: string }) => {
      sent.push({ tabId, type: message.type })
      if (message.type === 'axt:page-status') {
        if (status === undefined) throw new Error('Receiving end does not exist')
        return status
      }
      return {}
    }),
  }
  installContextMenu(deps as never)
  return { sent, created, click: (tabId?: number) => click?.({ menuItemId: MENU_ID }, tabId === undefined ? undefined : { id: tabId }) }
}

describe('右键菜单的翻译开关（#146）', () => {
  it('只在 arXiv 的 HTML 全文页上出现，但页面里点在什么上都有', async () => {
    // Chrome 按点中的目标给 context：点在引用链接上给 `link`、点在插图上给 `image`。论文页里
    // 这两样到处都是，只注册 `page` 的话最容易点到的地方反而没有菜单（Codex 在 #147 指出）
    const menu = fakeMenu()
    await Promise.resolve()
    expect(menu.created).toEqual([{ id: MENU_ID, title: MENU_TITLE, contexts: MENU_CONTEXTS, documentUrlPatterns: MENU_PATTERNS }])
    expect(MENU_PATTERNS).toEqual(['https://arxiv.org/html/*'])
    for (const ctx of ['link', 'image', 'selection', 'page']) expect(MENU_CONTEXTS).toContain(ctx)
  })

  it('三个真实状态各自去哪：idle 去翻，其余去恢复', () => {
    // 分界与 popup 的按钮一致（`canRestore` 是 `state !== 'idle'`）。**只有这三个值存在**——
    // 第一版按一个不存在的 `'off'` 判断，菜单于是永远发恢复（Codex 在 #147 指出）
    expect(actionFor(progress('idle'))).toBe('axt:translate-page')
    expect(actionFor(progress('on'))).toBe('axt:restore-page')
    expect(actionFor(progress('stopped'))).toBe('axt:restore-page')
    // 页面答不上状态：什么都不做，而不是瞎猜一个方向
    expect(actionFor(undefined)).toBeUndefined()
  })

  it('点一下：先问状态，再发与 popup 同一条消息', async () => {
    const menu = fakeMenu(progress('idle'))
    menu.click(7)
    await vi.waitFor(() => expect(menu.sent).toHaveLength(2))
    expect(menu.sent).toEqual([{ tabId: 7, type: 'axt:page-status' }, { tabId: 7, type: 'axt:translate-page' }])
  })

  it('页面还没装上 content script：问不到就算了，不抛出去', async () => {
    const menu = fakeMenu(undefined)
    menu.click(7)
    await vi.waitFor(() => expect(menu.sent).toHaveLength(1))
    expect(menu.sent).toEqual([{ tabId: 7, type: 'axt:page-status' }])
  })
})
