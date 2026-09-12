// 会话与链的绑定（DESIGN §8.0，Codex 在 #59 指出的两条）。
//
// 请求搬回 background 之后多出两个暴露面，都因为 scope 不再和「它从哪来、绑哪条链」关联：
//
// 1. 配置中途变更会换掉正在进行的那一轮用的链。popup 的提示词下拉写完就落盘，界面上明说
//    「恢复原文后再点翻译生效」；`chrome-builtin` 更是在构造时就把语言对固定下来，中途改目标语言
//    会让同一轮里先后出现两种语言。所以**一次会话认准它开始时的那条链**，重建只影响之后的会话。
// 2. 标签页关掉时队列还在 worker 里活着。搬迁前请求跑在 content 里，关页面连带就没了；现在不撤的话
//    关掉的标签页还会继续发付费请求，直到批次耗尽预算（单批最长 180 秒）。
import type { CancelledScopeRegistry } from '@/providers/request/cancellation'
import type { TranslationTransport } from '@/providers/transport'

export interface SessionRouter {
  /** 取这次调用该用的链：带 scope 的绑定到它开始时的那条，不带的（设置页连接测试）用当前那条 */
  forCall(scope: string | undefined, tabId: number | undefined): Promise<TranslationTransport>
  /**
   * 只记下 scope 属于哪个标签页，不建链、不等待：图片 OCR 的第一条请求要绑 tab 才撤得到，
   * 但不能让它等翻译链构造（Codex 在 #87 指出）。同一标签页的旧 scope 顺手撤掉
   */
  bind(scope: string, tabId: number | undefined): void
  /**
   * Bind a session to a given chain — the one whose status it was just told, so the settings it records are the
   * settings that serve it (provider-status.ts). Provisional: the tab's earlier sessions are dropped by this one's
   * first request (`forCall`), not now. Nothing happens for a scope already on a chain or already dropped
   */
  bindTo(scope: string, transport: TranslationTransport, tabId: number | undefined): void
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
   * Move one session onto the chain in force; the rest keep the one they started on. **Only for the
   * reader's explicit actions** (`axt:engine-ready` after a language pack downloaded): a passive
   * configuration change deliberately moves nothing, see the top of this file
   */
  rebind(scope: string): Promise<void>
  /**
   * Every session onto the chain in force, **and the work on the old ones drained**. Re-pointing alone
   * leaves whatever was queued or in flight running on the transport being replaced, so a deleted
   * service would go on spending its key and writing its results into the live page (Codex on #157).
   * Returns how many requests were cancelled
   */
  dropAndRebindAll(): Promise<number>
  /** The transport a session is bound to, without binding one; for answering questions about it */
  transportFor(scope: string): TranslationTransport | undefined
  /** How many sessions are on this chain; the chain holder keeps a superseded chain while any is */
  sessionsOn(transport: TranslationTransport): number
  /** 当前还绑着的 scope，按绑定顺序 */
  bound(): string[]
}

export interface SessionRouterDeps {
  /** The chain of the moment; after a configuration change it returns the new one, sessions already bound keep theirs */
  current: () => Promise<TranslationTransport>
  /**
   * The one registry of scopes ended for certain (ADR-0005). This router is its only writer; the translate services
   * and the OCR service read it, so a request that was suspended when its scope was drained is refused wherever it
   * wakes up — including on a chain built after the drop
   */
  cancelled: CancelledScopeRegistry
  /**
   * Called once per dropped scope, before the chain is asked: other things queue by scope besides translation
   * (image OCR, §15.2) and are drained with the session. Returns how many it drained. Whether the scope is dead
   * afterwards is not its concern — the registry answers that
   */
  onDrop?: (scope: string) => number
  /**
   * Asked when the grace period ends: is this tab still the page it was? The page itself can tell a same-document
   * hash change from a real navigation — if it is still there it still answers with the same session id. Without
   * this, a jump to a position that needs no new translation (already translated) produces no request to lift the
   * pending drop, and the batch in flight is drained for nothing (Codex on #143). Three answers, not a boolean:
   * `'same'` the page is there; `'other'` it answered with a different session — **a certain end**, the scope may
   * be marked; `'unknown'` the message did not arrive — maybe gone, maybe the new document's content script is not
   * installed yet, so drain only, mark nothing (Codex on #143: the two must be kept apart)
   */
  stillThere?: (tabId: number, scope: string) => Promise<'same' | 'other' | 'unknown'>
  /**
   * Is this tab still loading? While a cross-document navigation commits slowly the old document still answers
   * with the same session — "still there" is only credible once the tab is **no longer loading**. Loading: arm
   * again, a few rounds at most (Codex on #143: waiting for `complete` alone is not enough — when the destination's
   * load hangs, that event never comes)
   */
  stillLoading?: (tabId: number) => Promise<boolean>
  /**
   * Retire every chain other than the build in force, or every chain while that build has not landed (ADR-0005),
   * draining each of its scoped work — whichever session left it there — and returning the count. `dropAndRebindAll`
   * calls it first, before anything is awaited: a chain only a connection test used has no session that leads to
   * it, and a retired chain refuses every call that wakes or retries inside it, scoped or not. The router then
   * takes the retired chains off their sessions
   */
  retireOthers?: () => number
  /**
   * Drain a scope from every chain still holding its work, not only the one it is bound to: a session moved on
   * by a language pack leaves its earlier requests on a chain other sessions may still use, which is therefore
   * not retired (the local review of ADR-0005, seventeenth pass). Returns how many requests were cancelled
   */
  cancelScope?: (scope: string) => Promise<number>
}

/**
 * 「可能跳走了」按住多久再撤。
 *
 * 只需要盖住「页面还活着，正要为新露出来的内容发请求」这段：跳到参考文献之后，视口观察器在同一帧
 * 就把新块排上了。给到 3 秒是留足余量，代价是真跳走的标签页多跑 3 秒——原先那条路径的暴露上限是
 * 一个批次的预算（180 秒），这点增量可以忽略
 */
const NAVIGATION_GRACE_MS = 3000

export function createSessionRouter(deps: SessionRouterDeps): SessionRouter {
  /** transport 在第一次 forCall 时才填：bind 过的会话先只有 tabId */
  /**
   * `provisional`: bound to a chain at status time (`bindTo`), before the session has made a request. Such a binding
   * takes nothing from the tab's other sessions yet — a restart whose status came back late must not cancel the
   * restart that won (the local review of INVENTORY S2, eighth pass); the first request makes it the tab's session
   */
  const sessions = new Map<string, { transport?: TranslationTransport; tabId?: number; provisional?: true }>()
  /** 按住的「可能跳走了」，按标签页；这个标签页再来一次请求就取消 */
  const leaving = new Map<number, ReturnType<typeof setTimeout>>()

  /**
   * Per tab, the number of the navigation probe in force. A probe that awaited the page and finds itself
   * superseded — the tab closed, or a newer session on it armed a probe of its own — stops, instead of
   * re-arming its stale scopes over the newer timer (the local review of ADR-0005, fourth pass)
   */
  const probes = new Map<number, number>()
  /** 这个标签页还活着：把按住的撤销取消掉 */
  const stayed = (tabId: number | undefined): void => {
    if (tabId === undefined) return
    probes.set(tabId, (probes.get(tabId) ?? 0) + 1)
    const timer = leaving.get(tabId)
    if (timer === undefined) return
    clearTimeout(timer)
    leaving.delete(tabId)
  }

  /**
   * 「还在加载就再问一遍」最多几轮。
   *
   * 有上限是因为一直卡在加载中的标签页会让它变成一个永不停止的轮询。四轮 ~12 秒之后仍然
   * 在加载、而且页面还答得出同一个会话，那就当它确实是同一个文档
   */
  const LOADING_RETRIES = 3

  /**
   * @param options.remember the scopes are dead from now on (default): the reader stopped, the tab closed, the page
   *   answered with another session. A guessed end passes false — if the guess is wrong the page is still alive,
   *   and marking it would pin the rest of the paper on aborted (the reference-list failures of 2026-09-09)
   */
  const drop = async (scopes: readonly string[], { remember = true }: { remember?: boolean } = {}): Promise<number> => {
    // Mark before anything is awaited: a call suspended on its cache read wakes up to a scope already dead, on
    // this chain or on one built after the drop (ADR-0005)
    if (remember) for (const scope of scopes) deps.cancelled.markScope(scope)
    let cancelled = 0
    for (const scope of scopes) {
      const bound = sessions.get(scope)
      // A guessed end does **not** unbind: unbound, the scope's next request looks like a new session and `forCall`
      // hangs it on the **current** chain — if the reader changed engine, prompt or target language in between, one
      // page's translation switches chains midway, exactly what §8.0's "a session keeps the chain it started on"
      // prevents (Codex on #143). Drain, keep the binding: a real navigation clears it with the tab close or the next scope
      if (remember) sessions.delete(scope)
      // 别的按 scope 排队的东西（图片 OCR）先撤，不等建链：建链可能挂在 Translator.availability() 上（Codex 在 #87 指出）
      cancelled += deps.onDrop?.(scope) ?? 0
      // Every chain still holding the scope's work, not only the one it is bound to (see `cancelScope`); it
      // builds no chain and needs no binding — a scope never bound at all (the worker restarted, the binding
      // lost) may still have work queued somewhere
      if (deps.cancelScope) {
        cancelled += await deps.cancelScope(scope)
        continue
      }
      // Without the holder: 只经 bind 绑过、从没翻过字的会话（bound 有值、没 transport）：这个 worker 里没有它的翻译请求，不用为撤它建一条链。
      // 完全没绑过的也要撤：worker 中途重启过，绑定丢了但队列里可能还有这个 scope 的任务
      if (bound && !bound.transport) continue
      const transport = bound?.transport ?? await deps.current()
      cancelled += await transport.cancel(scope)
    }
    return cancelled
  }

  /**
   * 按住一次撤销，到点问页面自己。
   *
   * 「还在加载」时页面的回答不可信——正在离开的旧文档也还答得出同一个会话——所以那时不下结论，
   * 再按一次（有上限，见 `LOADING_RETRIES`）
   */
  const arm = (tabId: number, scopes: readonly string[], attempt: number): void => {
    stayed(tabId)
    if (scopes.length === 0) return
    const probe = probes.get(tabId)
    leaving.set(tabId, setTimeout(() => {
      leaving.delete(tabId)
      void (async () => {
        // 没有探针时按原来的判断走：证据仍然只有「这段时间没有请求」，那只够软撤
        const answers = deps.stillThere
          ? await Promise.all(scopes.map(s => deps.stillThere!(tabId, s)))
          : scopes.map(() => 'unknown' as const)
        if (probes.get(tabId) !== probe) return // superseded while the page was being asked
        const live = scopes.filter((_, i) => answers[i] === 'same')
        const loading = live.length > 0 && attempt < LOADING_RETRIES && await deps.stillLoading?.(tabId)
        if (probes.get(tabId) !== probe) return
        if (loading) {
          arm(tabId, scopes, attempt + 1)
          return
        }
        // 答上来了但换了会话：页面确实走了，这是确定的终结，判死——否则挂在 helper 握手上、
        // 还没进任何队列的那些请求醒来之后照发不误（Codex 在 #143 指出）
        const confirmed = scopes.filter((_, i) => answers[i] === 'other')
        const unsure = scopes.filter((_, i) => answers[i] === 'unknown')
        if (confirmed.length > 0) await drop(confirmed)
        if (unsure.length > 0) await drop(unsure, { remember: false })
      })()
    }, NAVIGATION_GRACE_MS))
  }

  const scopesOfTab = (tabId: number): string[] =>
    [...sessions].filter(([, session]) => session.tabId === tabId).map(([scope]) => scope)
  /**
   * The tab's sessions a newly registering scope supersedes: not the provisional ones. A provisional entry is a
   * replacement whose status is on its way to the page; the page's session of the moment may still send a request
   * meanwhile — after a worker restart it has no entry here and registers anew — and must not cancel the
   * replacement it is about to hand over to (the local review of INVENTORY S2, eleventh pass). A replacement's own
   * first request drops everything else on the tab
   */
  const supersededOn = (tabId: number, by: string): string[] =>
    [...sessions].filter(([scope, session]) => session.tabId === tabId && scope !== by && !session.provisional).map(([scope]) => scope)

  return {
    async forCall(scope, tabId) {
      // **不因为「这个标签页又发请求了」就取消按住的撤销**：真跳走时旧文档常常还能再发一两条，
      // 那只证明新文档还没接管，不证明页面还在。取消掉之后新文档一提交，content script 就没了，
      // 也没人再武装一次，旧会话的队列会一直跑（Codex 在 #143 指出）。到点问页面自己才是判据
      if (scope === undefined) return deps.current()
      const bound = sessions.get(scope)
      if (bound?.transport && !bound.provisional) return bound.transport
      if (bound?.provisional) {
        // The first request of a session bound at status time: now it is the tab's session, and the tab's earlier
        // ones are stale (a refresh, a navigation without endRun) — the same drop a new scope gets below, deferred
        // to here so that a binding made for a restart that lost cancels nothing (eighth pass). The drop happens
        // whether the provisional chain still stands or was retired meanwhile (ninth pass); a retired one is let go
        // and the loop below binds the chain in force, as for a fresh scope
        const { provisional: _, transport, ...rest } = bound
        const standing = transport && !transport.isRetired?.() ? transport : undefined
        sessions.set(scope, { ...rest, ...(standing ? { transport: standing } : {}), ...(tabId !== undefined ? { tabId } : {}) })
        const stale = tabId !== undefined ? scopesOfTab(tabId).filter(other => other !== scope) : []
        if (stale.length > 0) await drop(stale)
        if (standing) return standing
      }
      if (!bound && deps.cancelled.has(scope)) {
        // A dropped session calling again (the old content script in this worker still sends): hand it the current
        // chain, drained of the scope first — the registry refuses the request anyway
        const transport = await deps.current()
        await transport.cancel(scope)
        return transport
      }
      if (!bound) {
        // 一个标签页同时只有一个会话：出现新 scope 说明上一轮没走 endRun（导航、刷新），把它撤掉。
        // bind 过的（bound 有值、没 transport）已经在 bind 里撤过了
        const stale = tabId !== undefined ? supersededOn(tabId, scope) : []
        // Register before the first await, as bind() does for OCR: a tab closed while the chain is being built
        // must find this scope among its sessions, or dropTab marks nothing and the continuation below binds a
        // dead scope and lets its request out — one paid batch per request suspended here, and the binding
        // stays behind (the local review of ADR-0005 reproduced it; inherited from the MVP)
        sessions.set(scope, tabId !== undefined ? { tabId } : {})
        if (stale.length > 0) await drop(stale)
      }
      for (;;) {
        const built = await deps.current()
        // Dropped while the chain was being built (tab closed, page restored): the drop saw no transport and had
        // nothing to drain, and binding now would revive the session and let its requests through (Codex on #87).
        // Do not bind; drain this chain of the scope and hand it over — the registry refuses its calls anyway
        if (deps.cancelled.has(scope)) {
          await built.cancel(scope)
          return built
        }
        // A rebind during the build (engine-ready: `rebind`, `dropAndRebindAll`) already chose this session's chain;
        // the one the build returns is the chain of the moment it started, and must not overrule that choice
        const entry = sessions.get(scope)
        const chosen = entry?.transport && !entry.transport.isRetired?.() ? entry.transport : built
        // Retired while the build was awaited (a service deleted, its replacement still building): nobody's chain.
        // Wait for the replacement instead of binding it (the local review of ADR-0005, thirteenth pass)
        if (chosen.isRetired?.()) continue
        sessions.set(scope, { ...entry, transport: chosen, ...(tabId !== undefined ? { tabId } : {}) })
        return chosen
      }
    },
    bind(scope, tabId) {
      if (sessions.has(scope) || deps.cancelled.has(scope)) return
      if (tabId !== undefined) {
        const stale = supersededOn(tabId, scope)
        if (stale.length > 0) void drop(stale)
      }
      sessions.set(scope, tabId !== undefined ? { tabId } : {})
    },
    bindTo(scope, transport, tabId) {
      if (deps.cancelled.has(scope) || transport.isRetired?.()) return
      const bound = sessions.get(scope)
      if (bound?.transport) return
      sessions.set(scope, { ...bound, transport, provisional: true, ...(tabId !== undefined ? { tabId } : {}) })
    },
    drop,
    dropTab: tabId => {
      stayed(tabId)
      return drop(scopesOfTab(tabId))
    },
    mayHaveLeft(tabId) {
      // 现在挂在这个标签页上的会话，取的是**按住那一刻**的：页面自己第一次加载也会报 loading，
      // 那时它还没有会话，到点再取就会把这中间刚开起来的那个会话撤掉
      arm(tabId, scopesOfTab(tabId), 0)
    },
    async rebind(scope) {
      const transport = await deps.current()
      const session = sessions.get(scope)
      if (session) sessions.set(scope, { ...session, transport })
    },
    async dropAndRebindAll() {
      // Stopping the deleted service must not wait for its replacement: a rebuild can hang in an engine probe,
      // fail, or be superseded (the local review of ADR-0005, fourth, fifth, ninth, thirteenth and fourteenth
      // passes). 1. Before anything is awaited: the holder retires every chain but the build in force — every
      //    chain, while that build has not landed — draining each chain's scoped work, whichever session left it
      //    there (a session moved on by a language pack leaves its earlier requests behind; the registry does not
      //    mark it, so nothing else would stop them). The sessions on a retired chain lose it, keeping their
      //    scope → tab entries (a tab closing later must still find them: image recognition queues by scope too)
      const cancelled = deps.retireOthers?.() ?? 0
      const taken: string[] = []
      for (const [scope, session] of sessions) {
        if (!session.transport?.isRetired?.()) continue
        taken.push(scope)
        // A provisional session stays provisional: its deferred drop of the tab's earlier sessions is still owed
        sessions.set(scope, { ...(session.tabId !== undefined ? { tabId: session.tabId } : {}), ...(session.provisional ? { provisional: true as const } : {}) })
      }
      // 2. The replacement. A session binds it on its next request anyway (forCall); binding the ones taken off
      //    a chain now keeps status answers and the holder's ownership current. A failed rebuild surfaces here
      const transport = await deps.current()
      for (const scope of taken) {
        const session = sessions.get(scope)
        if (session && !session.transport) sessions.set(scope, { ...session, transport })
      }
      return cancelled
    },
    transportFor: scope => sessions.get(scope)?.transport,
    sessionsOn: transport => [...sessions.values()].filter(session => session.transport === transport).length,
    bound: () => [...sessions.keys()],
  }
}
