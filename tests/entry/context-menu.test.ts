import { describe, expect, it, vi } from 'vitest'
import { MENU_ID, MENU_PATTERNS, MENU_TITLE, actionFor, installContextMenu } from '@/entrypoints/background/context-menu'

// 右键菜单的开关（issue #146）。原生右键菜单在 Playwright 里驱动不了，所以「点了之后做什么」
// 只能在这一层钉住
function fakeMenu(status?: unknown) {
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
  it('只在 arXiv 的 HTML 全文页上出现', async () => {
    const menu = fakeMenu()
    await Promise.resolve()
    expect(menu.created).toEqual([{ id: MENU_ID, title: MENU_TITLE, contexts: ['page', 'selection'], documentUrlPatterns: MENU_PATTERNS }])
    expect(MENU_PATTERNS).toEqual(['https://arxiv.org/html/*'])
  })

  it('没在翻就翻，正在翻就恢复原文', () => {
    expect(actionFor({ progress: { state: 'off' } })).toBe('axt:translate-page')
    expect(actionFor({ progress: { state: 'on' } })).toBe('axt:restore-page')
    expect(actionFor({ progress: { state: 'done' } })).toBe('axt:restore-page')
    // 页面答不上状态：什么都不做，而不是瞎猜一个方向
    expect(actionFor(undefined)).toBeUndefined()
    expect(actionFor({})).toBeUndefined()
  })

  it('点一下：先问状态，再发与 popup 同一条消息', async () => {
    const menu = fakeMenu({ progress: { state: 'off' } })
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
