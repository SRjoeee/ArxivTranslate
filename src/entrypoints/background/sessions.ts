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
  /**
   * 只记下 scope 属于哪个标签页，不建链、不等待：图片 OCR 的第一条请求要绑 tab 才撤得到，
   * 但不能让它等翻译链构造（Codex 在 #87 指出）。同一标签页的旧 scope 顺手撤掉
   */
  bind(scope: string, tabId: number | undefined): void
  /** 撤掉这些 scope 并解绑，返回撤掉的条数 */
  drop(scopes: readonly string[]): Promise<number>
  /** 标签页关闭：撤掉挂在它上面的会话 */
  dropTab(tabId: number): Promise<number>
  /**
   * 这个标签页**可能**跳走了（`tabs.onUpdated` 报了 loading）。
   *
   * 只是可能：同文档换 hash 与真的跳到别的网址在那个事件里完全一样——实测两种情况 `changeInfo`
   * 都只有 `{status:'loading'}`，没有 `url` 可比（没有 `tabs` 权限）。所以不当场撤，先按住
   * `NAVIGATION_GRACE_MS`；这段时间里这个标签页只要还有一次请求，就说明页面还活着，取消这次撤销。
   * 真跳走的页面不会再有请求，宽限到点照撤（用户 2026-09-09 报的：点正文里的引用跳到参考文献，
   * 那一整块的译文全部失败）
   */
  mayHaveLeft(tabId: number): void
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
 *   撤会话时一起撤；返回它撤掉的条数。`remember` 一并传下去——猜出来的终结在那条队列上同样不能判死
 * @param options.stillThere 宽限到点时问一句「这个标签页还是刚才那个页面吗」。页面自己分得清同文档
 *   换 hash 与真的跳走：它还在就还答得出同一个会话 id。没有这个的话，跳到一个不需要新翻译的位置
 *   （目的地已经翻过了）就没有任何请求来取消撤销，正在翻的那一批会被白白排空（Codex 在 #143 指出）
 */
/**
 * 「可能跳走了」按住多久再撤。
 *
 * 只需要盖住「页面还活着，正要为新露出来的内容发请求」这段：跳到参考文献之后，视口观察器在同一帧
 * 就把新块排上了。给到 3 秒是留足余量，代价是真跳走的标签页多跑 3 秒——原先那条路径的暴露上限是
 * 一个批次的预算（180 秒），这点增量可以忽略
 */
const NAVIGATION_GRACE_MS = 3000

export function createSessionRouter(current: () => Promise<TranslationTransport>, options: { onDrop?: (scope: string, options: { remember: boolean }) => number; stillThere?: (tabId: number, scope: string) => Promise<boolean> } = {}): SessionRouter {
  /** transport 在第一次 forCall 时才填：bind 过的会话先只有 tabId */
  const sessions = new Map<string, { transport?: TranslationTransport; tabId?: number }>()
  /**
   * 撤过的 scope。会话 id 不会重复，撤过的不该再活过来：bind 之后 forCall 正在 `await current()` 时
   * 标签页关掉了——drop 看到的是"没 transport"就跳过了撤翻译，forCall 回来又把它 set 回去、请求照发
   *（Codex 在 #87 指出）。forCall 回来发现自己被撤过：不重新绑定，把 scope 在这条链上撤掉再交出去，
   * 之后带这个 scope 的请求在 translate-service 里直接 aborted
   */
  const dropped = new Set<string>()
  /** 按住的「可能跳走了」，按标签页；这个标签页再来一次请求就取消 */
  const leaving = new Map<number, ReturnType<typeof setTimeout>>()

  /** 这个标签页还活着：把按住的撤销取消掉 */
  const stayed = (tabId: number | undefined): void => {
    if (tabId === undefined) return
    const timer = leaving.get(tabId)
    if (timer === undefined) return
    clearTimeout(timer)
    leaving.delete(tabId)
  }

  /**
   * @param options.remember 撤过就判死（默认 true）。猜出来的终结传 false：猜错的话页面还活着，
   *   判死等于把它后半篇永久钉在 aborted 上
   */
  const drop = async (scopes: readonly string[], { remember = true }: { remember?: boolean } = {}): Promise<number> => {
    let cancelled = 0
    for (const scope of scopes) {
      const bound = sessions.get(scope)
      // 猜出来的终结**不解绑**：解绑之后这个 scope 再来请求就成了「没绑过的新会话」，`forCall` 会把它
      // 挂到**当前**那条链上——期间用户要是改过引擎 / 提示词 / 目标语言，同一轮译文就会中途换链，
      // 正好是 §8.0 那条「一次会话认准它开始时的那条链」要防的（Codex 在 #143 指出）。
      // 排空照做，绑定留着：真跳走的话这条记录跟着标签页关闭或下一轮新 scope 一起清掉
      if (remember) {
        sessions.delete(scope)
        dropped.add(scope)
      }
      // 别的按 scope 排队的东西（图片 OCR）先撤，不等建链：建链可能挂在 Translator.availability() 上（Codex 在 #87 指出）
      cancelled += options.onDrop?.(scope, { remember }) ?? 0
      // 只经 bind 绑过、从没翻过字的会话（bound 有值、没 transport）：这个 worker 里没有它的翻译请求，不用为撤它建一条链。
      // 完全没绑过的也要撤：worker 中途重启过，绑定丢了但队列里可能还有这个 scope 的任务
      if (bound && !bound.transport) continue
      const transport = bound?.transport ?? await current()
      cancelled += await transport.cancel(scope, { remember })
    }
    return cancelled
  }

  const scopesOfTab = (tabId: number): string[] =>
    [...sessions].filter(([, session]) => session.tabId === tabId).map(([scope]) => scope)

  return {
    async forCall(scope, tabId) {
      // 有请求就说明这个标签页的页面还活着：如果刚才 onUpdated 按住了一次撤销，取消它
      stayed(tabId)
      if (scope === undefined) return current()
      const bound = sessions.get(scope)
      if (bound?.transport) return bound.transport
      if (!bound && dropped.has(scope)) {
        // 撤过的会话又来请求（worker 里的旧 content 还在发）：给它当前链但先撤掉，请求会直接 aborted
        const transport = await current()
        await transport.cancel(scope)
        return transport
      }
      // 一个标签页同时只有一个会话：出现新 scope 说明上一轮没走 endRun（导航、刷新），把它撤掉。
      // bind 过的（bound 有值、没 transport）已经在 bind 里撤过了
      if (!bound && tabId !== undefined) {
        const stale = scopesOfTab(tabId)
        if (stale.length > 0) await drop(stale)
      }
      const transport = await current()
      // 建链期间被撤（关标签页 / 恢复原文）：不复活，补撤这条链上的它
      if (dropped.has(scope)) {
        await transport.cancel(scope)
        return transport
      }
      sessions.set(scope, { ...bound, transport, ...(tabId !== undefined ? { tabId } : {}) })
      return transport
    },
    bind(scope, tabId) {
      stayed(tabId)
      if (sessions.has(scope) || dropped.has(scope)) return
      if (tabId !== undefined) {
        const stale = scopesOfTab(tabId)
        if (stale.length > 0) void drop(stale)
      }
      sessions.set(scope, tabId !== undefined ? { tabId } : {})
    },
    drop,
    dropTab: tabId => {
      stayed(tabId)
      return drop(scopesOfTab(tabId))
    },
    mayHaveLeft(tabId) {
      stayed(tabId)
      // 现在挂在这个标签页上的会话，取的是**按住那一刻**的：页面自己第一次加载也会报 loading，
      // 那时它还没有会话，到点再取就会把这中间刚开起来的那个会话撤掉
      const scopes = scopesOfTab(tabId)
      if (scopes.length === 0) return
      leaving.set(tabId, setTimeout(() => {
        leaving.delete(tabId)
        void (async () => {
          // 没人问得到就按原来的判断走：这时的证据仍然只有「这段时间没有请求」
          const alive = options.stillThere ? await Promise.all(scopes.map(s => options.stillThere!(tabId, s))) : scopes.map(() => false)
          const gone = scopes.filter((_, i) => !alive[i])
          if (gone.length > 0) await drop(gone, { remember: false })
        })()
      }, NAVIGATION_GRACE_MS))
    },
    rebindAll(transport) {
      for (const [scope, session] of sessions) sessions.set(scope, { ...session, transport })
    },
    bound: () => [...sessions.keys()],
  }
}
