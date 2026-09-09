// Bind sessions to chains (DESIGN §8.0; two issues raised in Codex #59).
//
// Moving requests into background exposed two problems when scopes lost their association with source tabs and chains:
//
// 1. Mid-session config changes replaced the active chain. Popup prompt selection saves immediately but explicitly promises
//    to apply only after restore/restart. chrome-builtin fixes the language pair at construction, so changing targets mid-run could mix languages.
//    Therefore each session keeps its starting chain; rebuilding only affects later sessions.
// 2. Closing a tab leaves worker queues alive. Previously content-owned requests died with the page; without explicit cancellation,
//    closed tabs would keep sending paid requests until their batch budgets expire (up to 180s).
import type { TranslationTransport } from '@/providers/transport'

export interface SessionRouter {
  /** Select a chain: scoped calls bind to their starting chain; unscoped calls (settings tests) use the current chain. */
  forCall(scope: string | undefined, tabId: number | undefined): Promise<TranslationTransport>
  /**
   * Record scope ownership by tab without building or awaiting a chain. The first image OCR request needs this binding for cancellation,
   * but must not wait for translation-chain construction (Codex #87). Also cancel old scopes for the same tab.
   */
  bind(scope: string, tabId: number | undefined): void
  /** Cancel/unbind scopes and return the number of cancelled requests. */
  drop(scopes: readonly string[]): Promise<number>
  /** Tab close/navigation: cancel its bound sessions. */
  dropTab(tabId: number): Promise<number>
  /**
   * Move all active sessions to the new chain. Only for explicit user actions (axt:engine-ready after language pack download).
   * Passive config changes intentionally leave sessions in place; see the file header.
   */
  rebindAll(transport: TranslationTransport): void
  /** Currently bound scopes, in binding order. */
  bound(): string[]
}

/**
 * @param current Current chain; config changes produce a new one without affecting already-bound sessions.
 * @param options.onDrop Called for each cancelled scope to cancel other scoped work such as image OCR (§15.2),
 *   returning the number of cancelled requests.
 */
export function createSessionRouter(current: () => Promise<TranslationTransport>, options: { onDrop?: (scope: string) => number } = {}): SessionRouter {
  /** transport is assigned at the first forCall; bind alone records only tabId. */
  const sessions = new Map<string, { transport?: TranslationTransport; tabId?: number }>()
  /**
   * Cancelled scopes must not revive; session ids are unique. A tab can close after bind while forCall awaits current(),
   * so drop sees no transport and skips translation cancellation, then forCall would restore the binding and send requests.
   * If forCall resumes after cancellation, do not rebind; cancel the scope on that chain before returning it
   * so translate-service immediately aborts subsequent scoped requests (Codex #87).
   */
  const dropped = new Set<string>()

  const drop = async (scopes: readonly string[]): Promise<number> => {
    let cancelled = 0
    for (const scope of scopes) {
      const bound = sessions.get(scope)
      sessions.delete(scope)
      dropped.add(scope)
      // Cancel other scoped work (image OCR) without awaiting a chain that may hang on Translator.availability() (Codex #87).
      cancelled += options.onDrop?.(scope) ?? 0
      // A scope bound without transport has never translated text in this worker; do not build a chain solely to cancel it.
      // Cancel unbound scopes too: a worker restart can lose bindings while queued work for the scope may remain.
      if (bound && !bound.transport) continue
      const transport = bound?.transport ?? await current()
      cancelled += await transport.cancel(scope)
    }
    return cancelled
  }

  const scopesOfTab = (tabId: number): string[] =>
    [...sessions].filter(([, session]) => session.tabId === tabId).map(([scope]) => scope)

  return {
    async forCall(scope, tabId) {
      if (scope === undefined) return current()
      const bound = sessions.get(scope)
      if (bound?.transport) return bound.transport
      if (!bound && dropped.has(scope)) {
        // An old content script may keep requesting with a cancelled scope; return the current chain after cancelling that scope on it.
        const transport = await current()
        await transport.cancel(scope)
        return transport
      }
      // One session per tab: a new scope means the old run missed endRun (navigation/reload), so cancel it.
      // Scopes already bound without transport were handled by bind.
      if (!bound && tabId !== undefined) {
        const stale = scopesOfTab(tabId)
        if (stale.length > 0) await drop(stale)
      }
      const transport = await current()
      // Cancelled during chain construction (tab close/restore): do not revive; also cancel on this chain.
      if (dropped.has(scope)) {
        await transport.cancel(scope)
        return transport
      }
      sessions.set(scope, { ...bound, transport, ...(tabId !== undefined ? { tabId } : {}) })
      return transport
    },
    bind(scope, tabId) {
      if (sessions.has(scope) || dropped.has(scope)) return
      if (tabId !== undefined) {
        const stale = scopesOfTab(tabId)
        if (stale.length > 0) void drop(stale)
      }
      sessions.set(scope, tabId !== undefined ? { tabId } : {})
    },
    drop,
    dropTab: tabId => drop(scopesOfTab(tabId)),
    rebindAll(transport) {
      for (const [scope, session] of sessions) sessions.set(scope, { ...session, transport })
    },
    bound: () => [...sessions.keys()],
  }
}
