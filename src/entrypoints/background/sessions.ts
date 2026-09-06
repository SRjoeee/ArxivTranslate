// 会话与链的绑定（DESIGN §8.0，Codex 在 #59 指出的两条）。
//
// 请求搬回 background 之后多出两个暴露面，都因为 scope 不再和「它从哪来、绑哪条链」关联：
//
// 1. 配置中途变更会换掉正在进行的那一轮用的链。popup 的提示词下拉写完就落盘，界面上明说
//    「恢复原文后再点翻译生效」；`chrome-builtin` 更是在构造时就把语言对固定下来，中途改目标语言
//    会让同一轮里先后出现两种语言。所以**一次会话认准它开始时的那条链**，重建只影响之后的会话。
// 2. 标签页关掉时队列还在 worker 里活着。搬迁前请求跑在 content 里，关页面连带就没了；现在不撤的话
//    关掉的标签页还会继续发付费请求，直到批次耗尽预算（单批最长 180 秒）。
import type { TranslationTransport } from '@/providers/transport'

export interface SessionRouter {
  /** 取这次调用该用的链：带 scope 的绑定到它开始时的那条，不带的（设置页连接测试）用当前那条 */
  forCall(scope: string | undefined, tabId: number | undefined): Promise<TranslationTransport>
  /** 撤掉这些 scope 并解绑，返回撤掉的条数 */
  drop(scopes: readonly string[]): Promise<number>
  /** 标签页关闭 / 导航：撤掉挂在它上面的会话 */
  dropTab(tabId: number): Promise<number>
  /**
   * 把所有进行中的会话迁到新链上。**只给用户的显式动作用**（下载完语言包后的 `axt:engine-ready`）：
   * 被动的配置变更故意不迁，见本文件开头
   */
  rebindAll(transport: TranslationTransport): void
  /** 当前还绑着的 scope，按绑定顺序 */
  bound(): string[]
}

/**
 * @param current 取「此刻的」链；配置变更后它返回新的一条，已绑定的会话不受影响
 * @param options.onDrop 每撤掉一个 scope 调一次：翻译队列之外还有别的按 scope 排队的东西（图片 OCR，§15.2），
 *   撤会话时一起撤；返回它撤掉的条数
 */
export function createSessionRouter(current: () => Promise<TranslationTransport>, options: { onDrop?: (scope: string) => number } = {}): SessionRouter {
  const sessions = new Map<string, { transport: TranslationTransport; tabId?: number }>()

  const drop = async (scopes: readonly string[]): Promise<number> => {
    let cancelled = 0
    for (const scope of scopes) {
      const bound = sessions.get(scope)
      sessions.delete(scope)
      // 没绑过也要撤：worker 中途重启过，绑定丢了但队列里可能还有这个 scope 的任务
      const transport = bound?.transport ?? await current()
      cancelled += await transport.cancel(scope)
      cancelled += options.onDrop?.(scope) ?? 0
    }
    return cancelled
  }

  const scopesOfTab = (tabId: number): string[] =>
    [...sessions].filter(([, session]) => session.tabId === tabId).map(([scope]) => scope)

  return {
    async forCall(scope, tabId) {
      if (scope === undefined) return current()
      const bound = sessions.get(scope)
      if (bound) return bound.transport
      // 一个标签页同时只有一个会话：出现新 scope 说明上一轮没走 endRun（导航、刷新），把它撤掉
      if (tabId !== undefined) {
        const stale = scopesOfTab(tabId)
        if (stale.length > 0) await drop(stale)
      }
      const transport = await current()
      sessions.set(scope, { transport, ...(tabId !== undefined ? { tabId } : {}) })
      return transport
    },
    drop,
    dropTab: tabId => drop(scopesOfTab(tabId)),
    rebindAll(transport) {
      for (const [scope, session] of sessions) sessions.set(scope, { ...session, transport })
    },
    bound: () => [...sessions.keys()],
  }
}
