# ADR-0005: One registry of cancelled scopes

- Status: accepted (2026-09-12); third structural change of the rebuild
- Evidence: `docs/rebuild/INVENTORY.md` S3; `inventory/runtime.md` D2; commit dbe0ca4 (a fix for one copy that had been missed)

## Context

A translation session's scope can end for certain — the reader restores the page, closes the tab, or the page itself reports a different session — or only probably, when `tabs.onUpdated` reports a load that may be a same-document hash change. The background answered the two cases with the same `remember` flag written in three places:

- `entrypoints/background/sessions.ts` kept `dropped: Set<string>` (unbounded), added on a remembered drop, read by `forCall` and `bind` so a dropped scope is never re-bound.
- every `createTranslateService` owned a `CancelledScopeRegistry` (ported from Read Frog, TTL ten minutes, 256 entries), marked by its own `cancel(scope, { remember })`, read after the cache read, before the cache write and by the batch queue's liveness hook. A chain of three engines had three registries; a rebuilt chain started with empty ones, which is why `forCall` had to cancel a dead scope again on whatever chain it met.
- `entrypoints/background/ocr.ts` kept `cancelled: Set<string>` (unbounded), marked by its own `cancel(scope, { remember })`, read at entry and after the cache read.

Each copy carried its own reading of `remember`, `CancelOptions` had to travel through `TranslationTransport`, `TranslateService`, the fallback service and `OcrService` so the router's decision reached every store, and the guard ledger records a fix (dbe0ca4) for one copy that had been left out. The content script's `alive()` (ADR-0004) is not a fourth copy of this fact: it is the page's own view of its session and lives in another realm.

## Decisions

1. **One registry, created once, injected everywhere.** `background/index.ts` creates a single `CancelledScopeRegistry` and hands it to the session router, to `createLocalTransport` (which passes it to every `createTranslateService`, on-chain and off-chain) and to `createOcrService`. The registry is a required dependency of all four factories — `pnpm typecheck` is what proves the wiring is complete.
2. **The router is the only writer.** Whether a scope is dead for certain is the router's decision (`drop` with `remember`, the default; the grace-period probe's `unknown` answer and `dropAndRebindAll` drain without marking). The services only read: `TranslateService.cancel(scope)`, `TranslationTransport.cancel(scope)` and `OcrService.cancel(scope)` drain queued and in-flight work and return the count; `CancelOptions` is gone.
3. **Mark before anything is awaited.** `drop` marks every scope it was given before it drains any of them, so a call suspended on its cache read wakes up to a scope already dead — the property the service-level "mark, then drain" used to provide, now guaranteed once and for every reader, including a chain built after the drop.
4. **Nothing expires.** The ported registry pruned entries by a TTL (ten minutes) and a size cap (256); the first version of this change kept both, and the local review reproduced the consequence: a `forCall` held on a chain build while its tab closed, followed by 256 other drops, woke to an evicted mark, bound the dead session and let its request reach the provider. The router's old `dropped` set never forgot, and the property it gave — a scope ended for certain stays ended for the worker's life — is a correctness guarantee, not a memory policy (charter §4). The registry is therefore a set that only grows: an entry is a few dozen bytes per ended session, and the worker's own life bounds it (recycled after thirty idle seconds). Session ids are never reused, so remembering can never wrongly refuse a live request.
5. **Ported code keeps what is called** (ADR-0001 §9). `CancelledScopeRegistry` is rewritten to the two calls that remain, `markScope` and `has` — no prefix marks (the router drops by exact scope), no pruning; `TranslationCancelledError` stays as ported. The attribution header and `docs/THIRD_PARTY.md` record the change.

## Consequences

- One place answers "is this scope dead", one place decides it; a service built for a new chain or a new OCR backend (ADR-0002) reads the same answer without being told again.
- The router's tests observe the soft/hard distinction on the registry instead of on a flag echoed by a fake transport; the service and OCR tests mark the registry the way the router does before asserting that later calls are refused.
- `tests/providers/request/cancellation.test.ts` loses its prefix, TTL and size-cap cases; a router test pins that a certain drop survives hundreds of later drops and ten minutes with a chain build held. The queues' `cancelWhere` (called by `cancelByScope`) is untouched.
- The review's second pass surfaced an inherited race in the same bookkeeping, fixed here in its own commit: a text request's first `forCall` registered its scope only after the chain build, so a tab closed during the build found no session to drop and the continuation bound the dead scope and let the request out. `forCall` now records the scope and tab before its first await, as `bind` does for OCR; and a `rebind` / `dropAndRebindAll` that lands during the build keeps its choice instead of being overruled by the chain the build returns. Pinned by a router test and by a router-plus-real-service test in `tests/providers/transport.test.ts`.
