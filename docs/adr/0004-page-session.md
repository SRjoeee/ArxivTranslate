# ADR-0004: One page session, one permanent-error policy

- Status: accepted (2026-09-12); second structural change of the rebuild
- Evidence: `docs/rebuild/INVENTORY.md` T2, S4, S9; `inventory/core.md` §4.3, §5.10; `inventory/ui.md` §7

## Context

`src/entrypoints/content/index.ts` (467 lines) was the only place that assembled `core`: it owned the running session's state (`run`, `images`, `title`, `highlight`, `modes`, `prep`, `progress`, `running`, `current`, `restarted`, `resumeRaster`, two adoption gates), decided what a permanent hand-over means, restarted the page, answered `axt:page-status`, and reacted to every configuration change — and none of it was under a unit test. Session identity lived in a module-level singleton (`scheduler/session.ts`: `beginSession` / `endSession` / `getSessionId`), and thirteen call sites compared `getSessionId()` against a captured id by hand. "Which error kinds are permanent" (`no-key`, `auth`) was written five times: `fallback.ts`, `translate-service.ts` (twice), `pipeline/run.ts`, `image/run.ts`, plus an inline `kind !== 'no-key' && kind !== 'auth'` in the content entry.

## Decisions

1. **The session is an object, not a script.** `src/core/session/index.ts` exports `createPageSession(deps)`; it owns everything the content entry used to hold and exposes the operations the page has: `start`, `restore`, `setMode`, `translate` (retry), `resumeRaster`, `onConfig`, `status`, `ready`. Its dependencies — document, blocks, paper id and context, the translation transport, OCR and helper probes, the configuration store, locale application, tracing — are injected, so the whole lifecycle runs under vitest against a happy-dom document and fake backends, the way `pipeline/run.ts` already does.
2. **Session identity belongs to the session.** The module singleton is gone; `scheduler/session.ts` keeps only `newSessionId()` (its id format and attribution). Each `start()` captures its own id and closes over one `alive()`; there is no other way to ask "is this still the current session".
3. **One permanent-error policy.** `providers/types.ts` exports `PERMANENT_ERROR_KINDS` and `isPermanentErrorKind()`; the fallback chain, the translate service, both pipelines and the session read that, nothing else. The meaning is unchanged: `no-key` and `auth`.
4. **The content entry is an adapter.** `entrypoints/content/index.ts` extracts the blocks, builds the session with the real browser dependencies, and maps `axt:*` messages, `watchConfig` and the URL hash onto session calls. It contains no session state.
5. **Behaviour is characterised before it is simplified.** `tests/session/page-session.test.ts` fixes what the page does today — start and refuse-to-start reasons, restore, the restart-from-a-stale-session guard, the one-per-session automatic restart on a permanent hand-over, the appearance and locale gates against late reads, mode changes and their persistence, image runs parked until the helper answers and released by `resumeRaster`, `page-status` shape — and the e2e suites remain the acceptance.

Out of scope, left for their own ADRs on their own evidence: merging the text and image run state machines (INVENTORY P1), the four copies of "scope cancelled" in the background (S3).

## Consequences

- The next maintainer reads one file to learn what a translation session is, and can change it with a test that fails first.
- `tests/scheduler/session.test.ts` is replaced by the session tests; nothing else depended on the singleton.
- Two thin adapters remain by design: the content entry (browser messages) and, unchanged here, the popup's data layer.
