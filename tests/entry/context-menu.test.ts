import { describe, expect, it, vi } from 'vitest'
import { COMMAND_ID, MENU_CONTEXTS, MENU_ID, MENU_PATTERNS, installContextMenu, installToggleCommand, menuTitle } from '@/entrypoints/background/context-menu'
import type { Progress } from '@/core/pipeline/run'

/** Progress in its real shape: the first version wrote an improvised `{ state: 'off' }` here, a value `Progress` does not have at all,
 *  so the bug “the menu always sends restore and never once starts a translation” was covered up by the test (Codex on #147) */
const progress = (state: Progress['state']): { progress: Progress } =>
  ({ progress: { state, total: 10, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0 } })

// The context-menu toggle (issue #146). The native context menu cannot be driven in Playwright, so “what happens after the click”
// can only be pinned at this layer
function fakeMenu(status?: { progress: Progress; running?: { provider: string; target: string; engine: string; revision: string }; epoch?: string }, saved: { revision: string | null; canRun: boolean; fallback: boolean } | null = { revision: 'r1', canRun: true, fallback: false }) {
  const sent: { tabId: number; type: string; restart?: boolean; epoch?: string }[] = []
  const created: unknown[] = []
  let click: ((info: { menuItemId: string | number }, tab?: { id?: number }) => void) | undefined
  const deps = {
    create: (o: { id: string; title: string; contexts: string[]; documentUrlPatterns: string[] }) => { created.push(o) },
    removeAll: () => Promise.resolve(),
    onClicked: (h: (info: { menuItemId: string | number }, tab?: { id?: number }) => void) => { click = h },
    send: vi.fn(async (tabId: number, message: { type: string; restart?: boolean; epoch?: string }) => {
      sent.push({ tabId, type: message.type, ...(message.restart ? { restart: true } : {}), ...(message.epoch !== undefined ? { epoch: message.epoch } : {}) })
      if (message.type === 'axt:page-status') {
        if (status === undefined) throw new Error('Receiving end does not exist')
        return status
      }
      return {}
    }),
    saved: async () => saved,
  }
  installContextMenu(deps as never)
  return { sent, created, click: (tabId?: number) => click?.({ menuItemId: MENU_ID }, tabId === undefined ? undefined : { id: tabId }) }
}

describe('the context menu\'s translation toggle (#146)', () => {
  it('appears only on arXiv\'s HTML full-text pages, but wherever on the page the click lands', async () => {
    // Chrome gives the context by what was clicked: `link` on a citation link, `image` on a figure. A paper page is full of
    // both, and with `page` alone registered the places most likely to be clicked would have no menu (Codex on #147)
    const menu = fakeMenu()
    await Promise.resolve()
    expect(menu.created).toEqual([{ id: MENU_ID, title: menuTitle(), contexts: MENU_CONTEXTS, documentUrlPatterns: MENU_PATTERNS }])
    expect(MENU_PATTERNS).toEqual(['https://arxiv.org/html/*'])
    for (const ctx of ['link', 'image', 'selection', 'page']) expect(MENU_CONTEXTS).toContain(ctx)
  })

  it('the click handler is registered synchronously: when this click wakes the worker, the listener must already be there (Codex on #161)', () => {
    let removed: () => void = () => undefined
    const menu: { created: unknown[]; clicked: ((info: { menuItemId: string | number }, tab?: { id?: number }) => void) | null } = { created: [], clicked: null }
    installContextMenu({
      // removeAll hangs unsettled, imitating “the configuration read has not returned yet”
      create: options => menu.created.push(options),
      removeAll: () => new Promise(resolve => { removed = resolve }),
      onClicked: handler => { menu.clicked = handler },
      send: <T>() => Promise.resolve({} as T),
      saved: async () => null,
    })
    // The menu is not built yet, but the listener is there: the click that woke the worker does not fall on the floor
    expect(menu.created).toHaveLength(0)
    expect(menu.clicked).not.toBeNull()
    removed()
  })

  it('decides as the popup\'s main button does (shared/page-action.ts): a page behind the settings re-translates in place', async () => {
    // The key is badged on that button (user 2026-09-11); restoring here would contradict what the badge promises.
    // "Behind" is the page's revision against the saved settings' digest — the menu reads the settings for it
    const running = { provider: 'microsoft', target: 'cmn', engine: 'microsoft', revision: 'r1' }
    const behind = fakeMenu({ ...progress('on'), running }, { revision: 'r2', canRun: true, fallback: false })
    behind.click(7)
    await vi.waitFor(() => expect(behind.sent).toHaveLength(2))
    expect(behind.sent[1]).toEqual({ tabId: 7, type: 'axt:translate-page', restart: true })
    const current = fakeMenu({ ...progress('on'), running }, { revision: 'r1', canRun: true, fallback: false })
    current.click(7)
    await vi.waitFor(() => expect(current.sent).toHaveLength(2))
    expect(current.sent[1]).toEqual({ tabId: 7, type: 'axt:restore-page' })
  })

  it('a page behind settings that cannot run on their own is left alone, as the button it mirrors is disabled — a fallback does not make the toggle restart it (the local review of S2)', async () => {
    const running = { provider: 'microsoft', target: 'cmn', engine: 'microsoft', revision: 'r1' }
    const menu = fakeMenu({ ...progress('on'), running }, { revision: 'r2', canRun: false, fallback: true })
    menu.click(7)
    await vi.waitFor(() => expect(menu.sent).toHaveLength(1))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(menu.sent).toEqual([{ tabId: 7, type: 'axt:page-status' }])
    // Not translated yet, with a fallback to run on: that one starts, as the button does
    const idle = fakeMenu(progress('idle'), { revision: 'r1', canRun: false, fallback: true })
    idle.click(8)
    await vi.waitFor(() => expect(idle.sent).toHaveLength(2))
    expect(idle.sent[1]).toEqual({ tabId: 8, type: 'axt:translate-page' })
  })

  it('the command carries the page epoch it was decided on, a translate on an idle page included, so a page that moved while the settings were read refuses it (sixth and twelfth passes)', async () => {
    const running = { provider: 'microsoft', target: 'cmn', engine: 'microsoft', revision: 'r1' }
    const behind = fakeMenu({ ...progress('on'), running, epoch: 'd#4' }, { revision: 'r2', canRun: true, fallback: false })
    behind.click(7)
    await vi.waitFor(() => expect(behind.sent).toHaveLength(2))
    expect(behind.sent[1]).toEqual({ tabId: 7, type: 'axt:translate-page', restart: true, epoch: 'd#4' })
    const current = fakeMenu({ ...progress('on'), running, epoch: 'd#4' }, { revision: 'r1', canRun: true, fallback: false })
    current.click(7)
    await vi.waitFor(() => expect(current.sent).toHaveLength(2))
    expect(current.sent[1]).toEqual({ tabId: 7, type: 'axt:restore-page', epoch: 'd#4' })
    const idle = fakeMenu({ ...progress('idle'), epoch: 'd#2' })
    idle.click(7)
    await vi.waitFor(() => expect(idle.sent).toHaveLength(2))
    expect(idle.sent[1]).toEqual({ tabId: 7, type: 'axt:translate-page', epoch: 'd#2' })
  })

  it('the saved settings cannot be read: a running page restores, an idle one is left alone — unknown settings are not settings that run (Codex on #184)', async () => {
    const menu = fakeMenu({ ...progress('on'), running: { provider: 'microsoft', target: 'cmn', engine: 'microsoft', revision: 'r1' } }, null)
    menu.click(7)
    await vi.waitFor(() => expect(menu.sent).toHaveLength(2))
    expect(menu.sent[1]).toEqual({ tabId: 7, type: 'axt:restore-page' })
    const idle = fakeMenu(progress('idle'), null)
    idle.click(8)
    await vi.waitFor(() => expect(idle.sent).toHaveLength(1))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(idle.sent).toEqual([{ tabId: 8, type: 'axt:page-status' }])
  })

  it('one click: asks for the status first, then sends the same message as the popup', async () => {
    const menu = fakeMenu(progress('idle'))
    menu.click(7)
    await vi.waitFor(() => expect(menu.sent).toHaveLength(2))
    expect(menu.sent).toEqual([{ tabId: 7, type: 'axt:page-status' }, { tabId: 7, type: 'axt:translate-page' }])
  })

  it('the page has no content script yet: with no answer it lets it go, nothing thrown', async () => {
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
    saved: async () => ({ revision: 'r1', canRun: true, fallback: false }),
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
