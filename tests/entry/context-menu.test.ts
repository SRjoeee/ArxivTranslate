import { describe, expect, it, vi } from 'vitest'
import { COMMAND_ID, MENU_CONTEXTS, MENU_ID, MENU_PATTERNS, actionFor, installContextMenu, installToggleCommand, menuTitle } from '@/entrypoints/background/context-menu'
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
    expect(menu.created).toEqual([{ id: MENU_ID, title: menuTitle(), contexts: MENU_CONTEXTS, documentUrlPatterns: MENU_PATTERNS }])
    expect(MENU_PATTERNS).toEqual(['https://arxiv.org/html/*'])
    for (const ctx of ['link', 'image', 'selection', 'page']) expect(MENU_CONTEXTS).toContain(ctx)
  })

  it('点击处理同步注册：worker 被这次点击唤醒时，监听器必须已经在了（Codex 在 #161 指出）', () => {
    let removed: () => void = () => undefined
    const menu: { created: unknown[]; clicked: ((info: { menuItemId: string | number }, tab?: { id?: number }) => void) | null } = { created: [], clicked: null }
    installContextMenu({
      // removeAll 挂着不结算，模拟「读配置还没回来」
      create: options => menu.created.push(options),
      removeAll: () => new Promise(resolve => { removed = resolve }),
      onClicked: handler => { menu.clicked = handler },
      send: <T>() => Promise.resolve({} as T),
    })
    // 菜单还没建出来，但监听器已经在：这一次唤醒的点击不会掉地上
    expect(menu.created).toHaveLength(0)
    expect(menu.clicked).not.toBeNull()
    removed()
  })

  it('三个真实状态各自去哪：idle 去翻，其余去恢复', () => {
    // 分界与 popup 的按钮一致（`canRestore` 是 `state !== 'idle'`）。**只有这三个值存在**——
    // 第一版按一个不存在的 `'off'` 判断，菜单于是永远发恢复（Codex 在 #147 指出）
    expect(actionFor(progress('idle'))).toBe('axt:translate-page')
    expect(actionFor(progress('on'))).toBe('axt:restore-page')
    expect(actionFor(progress('stopped'))).toBe('axt:restore-page')
    // 致命错误停下的那种「已停止」是要重试的：popup 的主按钮就写着「重新翻译」，快捷键角标贴在它上面，
    // 这里若恢复原文就会把读者想重试的译文一起删掉（Codex 在 #157 指出）
    expect(actionFor({ progress: { ...progress('stopped').progress, fatal: 'auth: bad key' } })).toBe('axt:translate-page')
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

// The keyboard command (UI.md S-P-50): the third entry, on the same toggle as the menu
function fakeCommand(status: { progress: Progress } | undefined, active: { id?: number } | undefined) {
  const sent: { tabId: number; type: string }[] = []
  let fire: ((command: string, tab?: { id?: number }) => void) | undefined
  installToggleCommand({
    onCommand: (h: (command: string, tab?: { id?: number }) => void) => { fire = h },
    activeTab: async () => active,
    send: vi.fn(async (tabId: number, message: { type: string }) => {
      sent.push({ tabId, type: message.type })
      if (message.type === 'axt:page-status') {
        if (status === undefined) throw new Error('Receiving end does not exist')
        return status
      }
      return {}
    }),
  } as never)
  return { sent, fire: (command: string, tab?: { id?: number }) => fire?.(command, tab) }
}

describe('the keyboard command (S-P-50)', () => {
  it('toggles the tab it was fired on, same messages as the menu', async () => {
    const cmd = fakeCommand(progress('on'), undefined)
    cmd.fire(COMMAND_ID, { id: 4 })
    await vi.waitFor(() => expect(cmd.sent).toHaveLength(2))
    expect(cmd.sent).toEqual([{ tabId: 4, type: 'axt:page-status' }, { tabId: 4, type: 'axt:restore-page' }])
  })

  it('falls back to the active tab when the event carries none', async () => {
    const cmd = fakeCommand(progress('idle'), { id: 9 })
    cmd.fire(COMMAND_ID)
    await vi.waitFor(() => expect(cmd.sent).toHaveLength(2))
    expect(cmd.sent.map(m => m.tabId)).toEqual([9, 9])
  })

  it('ignores other commands and a missing tab', async () => {
    const cmd = fakeCommand(progress('idle'), undefined)
    cmd.fire('something-else', { id: 4 })
    cmd.fire(COMMAND_ID)
    await new Promise(r => setTimeout(r, 20))
    expect(cmd.sent).toEqual([])
  })
})
