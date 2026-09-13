// The binding of sessions to chains (DESIGN §8.0; the two points Codex made on #59).
//
// Moving the requests back into the background opened two exposures, both because a scope was no longer tied to
// “where it came from and which chain it is bound to”:
// 1. A configuration change halfway swaps the chain a round in progress is using. The popup's prompt drop-down writes
//    to disk as soon as it is set, and the interface says outright “takes effect on the next translation after
//    restore”; `chrome-builtin` even fixes the language pair at construction, so changing the target language halfway
//    would give one round two languages. So **a session holds to the chain it started on**, and a rebuild affects
//    later sessions only.
// 2. When a tab closes, its queues live on in the worker. Before the move the requests ran in the content script and
//    died with the page; now, unwithdrawn, a closed tab would keep sending paid requests until the batches exhausted
//    their budget (up to 180 seconds a batch).
import type { CancelledScopeRegistry } from '@/providers/request/cancellation'
import type { TranslationTransport } from '@/providers/transport'

export interface SessionRouter {
  /** The chain this call should use: with a scope, the one it was bound to at its start; without (the settings page's connection test), the current one */
  forCall(scope: string | undefined, tabId: number | undefined): Promise<TranslationTransport>
  /**
   * Record only which tab a scope belongs to, building no chain and awaiting nothing: an image OCR's first request has
   * to be bound to its tab to be withdrawable, but must not wait for the translation chain to build (Codex on #87). The tab's old scopes are withdrawn along the way
   */
  bind(scope: string, tabId: number | undefined): void
  /**
   * Bind a session to a given chain — the one whose status it was just told, so the settings it records are the
   * settings that serve it (provider-status.ts). Provisional: the tab's earlier sessions are dropped by this one's
   * first request (`forCall`), not now. Nothing happens for a scope already on a chain or already dropped
   */
  bindTo(scope: string, transport: TranslationTransport, tabId: number | undefined): void
  /** Withdraw these scopes and unbind them; returns how many were withdrawn */
  drop(scopes: readonly string[]): Promise<number>
  /** The tab closed: withdraw the sessions hanging on it */
  dropTab(tabId: number): Promise<number>
  /**
   * This tab **may** have navigated away (`tabs.onUpdated` reported loading).
   *
   * Only may: a same-document hash change and a real move to another URL look exactly alike in that event —
   * measured, `changeInfo` is `{status:'loading'}` alone in both cases, with no `url` to compare (no `tabs`
   * permission). So nothing is withdrawn on the spot; it is held for `NAVIGATION_GRACE_MS`, and one request from this
   * tab in that time means the page is alive and cancels the withdrawal. A page really gone makes no more requests, and
   * the withdrawal goes ahead at the deadline (reported by the owner on 2026-09-09: clicking a citation in the body that jumps to the references failed the whole block's translations)
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
  /** The scopes still bound, in binding order */
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
 * How long a “may have navigated away” is held before withdrawing.
 *
 * It only has to cover “the page is alive and about to request the content just revealed”: after a jump to the
 * references, the viewport observer queues the new blocks in the same frame. 3 seconds leaves ample room, at the
 * cost of a tab really gone running 3 seconds longer — the old path's exposure was one batch's budget (180 seconds), and this increment is negligible
 */
const NAVIGATION_GRACE_MS = 3000

export function createSessionRouter(deps: SessionRouterDeps): SessionRouter {
  /** Filled by the transport at the first forCall: a session that was only bound has a tabId alone */
  /**
   * `provisional`: bound to a chain at status time (`bindTo`), before the session has made a request. Such a binding
   * takes nothing from the tab's other sessions yet — a restart whose status came back late must not cancel the
   * restart that won (the local review of INVENTORY S2, eighth pass); the first request makes it the tab's session
   */
  const sessions = new Map<string, { transport?: TranslationTransport; tabId?: number; provisional?: true }>()
  /** The held “may have navigated away”, per tab; one more request from the tab cancels it */
  const leaving = new Map<number, ReturnType<typeof setTimeout>>()

  /**
   * Per tab, the number of the navigation probe in force. A probe that awaited the page and finds itself
   * superseded — the tab closed, or a newer session on it armed a probe of its own — stops, instead of
   * re-arming its stale scopes over the newer timer (the local review of ADR-0005, fourth pass)
   */
  const probes = new Map<number, number>()
  /** This tab is alive: the held withdrawal is cancelled */
  const stayed = (tabId: number | undefined): void => {
    if (tabId === undefined) return
    probes.set(tabId, (probes.get(tabId) ?? 0) + 1)
    const timer = leaving.get(tabId)
    if (timer === undefined) return
    clearTimeout(timer)
    leaving.delete(tabId)
  }

  /**
   * How many rounds of “still loading, ask again” at most.
   *
   * Capped because a tab stuck loading would turn this into a poll that never stops. Still loading after four rounds
   * (~12 seconds) and the page still answering with the same session, it is taken for the same document
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
      // Whatever else is queued by scope (image OCR) is withdrawn first, without waiting for the chain: building it may hang on Translator.availability() (Codex on #87)
      cancelled += deps.onDrop?.(scope) ?? 0
      // Every chain still holding the scope's work, not only the one it is bound to (see `cancelScope`); it
      // builds no chain and needs no binding — a scope never bound at all (the worker restarted, the binding
      // lost) may still have work queued somewhere
      if (deps.cancelScope) {
        cancelled += await deps.cancelScope(scope)
        continue
      }
      // Without the holder: a session only bound and never translating (bound set, no transport) has no translation
      // request in this worker, and no chain is built to withdraw it. One never bound is withdrawn too: the worker restarted halfway, the binding is lost, but the queues may still hold this scope's tasks
      if (bound && !bound.transport) continue
      const transport = bound?.transport ?? await deps.current()
      cancelled += await transport.cancel(scope)
    }
    return cancelled
  }

  /**
   * Hold a withdrawal, and ask the page itself at the deadline.
   *
   * While “still loading” the page's answer cannot be trusted — an old document on its way out still answers with the
   * same session — so no conclusion is drawn then, and it is held once more (capped, see `LOADING_RETRIES`)
   */
  const arm = (tabId: number, scopes: readonly string[], attempt: number): void => {
    stayed(tabId)
    if (scopes.length === 0) return
    const probe = probes.get(tabId)
    leaving.set(tabId, setTimeout(() => {
      leaving.delete(tabId)
      void (async () => {
        // Without a probe the old judgement stands: the only evidence is still “no request in this time”, enough for a soft withdrawal only
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
        // Answered, but with another session: the page really left, a certain end, sentenced — otherwise the requests hung
        // on the helper handshake, in no queue yet, would go out as usual once they woke (Codex on #143)
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
      // **A held withdrawal is not cancelled because “this tab requested again”**: on a real departure the old document
      // can often send one or two more, which only proves the new document has not taken over, not that the page is
      // there. Cancelled, the content script is gone once the new document commits, nobody arms it again, and the old session's queue runs on (Codex on #143). Asking the page itself at the deadline is the criterion
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
        // One session per tab at a time: a new scope means the previous round never went through endRun (navigation, a
        // reload), so it is withdrawn. A bound one (bound set, no transport) was withdrawn in bind already
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
      // The sessions hanging on this tab are taken **as of the hold**: a page's own first load reports loading too, when it
      // has no session yet, and taken at the deadline that would withdraw the session just started in between
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
