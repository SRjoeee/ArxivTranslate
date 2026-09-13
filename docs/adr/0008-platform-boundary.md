# ADR-0008: The platform boundary — a core that any host can run

- Status: proposed (2026-09-13); the owner's direction of the same day: V1.0 does not include the web reader, but the architecture makes the core capabilities easy to reference and plug in later
- Evidence: roadmap #155 Phase 2 item 1 (draw the boundary between what touches `chrome.*` and pure DOM); `docs/rebuild/INVENTORY.md` §1 (the system map) and §4.3 T2 (the content entry's orchestration); the import census of 2026-09-13 (`scripts/check-boundary.mjs`, 92 core files)

## Context

The extension has three kinds of code. **The core** turns an arXiv HTML page into a translated one: the rules (`src/core/rules`), the extractor, the protector, the renderer, the scheduler, the pipelines, the session (`src/core/**`), the engines and the queues (`src/providers/**`), the translation cache (`src/cache/**`). It needs a DOM, `fetch`, IndexedDB and Web Crypto — every one a web platform API, none of them Chrome's. **The platform layer** is what only an extension has: the entry points (`src/entrypoints/**` — background worker, content script, popup, options), the WXT-backed configuration store (`src/config/storage.ts`), runtime messaging (`src/shared/messages.ts`, `src/shared/transport.ts`), the native-messaging helper client, the UI (`src/ui/**`) and the locale packs (`src/locales/**`). **Between them** sit the data modules both sides read: the configuration schema (`src/config/schema.ts`, `services.ts`, `appearance.ts`, `languages.ts`) and the shared types (`src/shared/ocr.ts`, `page-action.ts`, `pack.ts`).

The census of 2026-09-13 found the core two imports away from being platform-free: `renderer/failed.ts` read the retry label and the failure sentence from `ui/strings.ts` (the locale layer), and `core/session/index.ts` answered a refused start with a sentence from the same place. Everything else the core needs it already receives as a dependency: the session takes `backend` (a `TranslationTransport`), `ocr`, `helperStatus`, `config: { get, set }`, `applyLocale` and `trace` from the content entry; the providers take `fetch`; the cache takes a Dexie database.

The owner's decision of 2026-09-13 settles the scope: **no web reader in V1.0**, and no package is extracted or published now. What V1.0 owes the future is that the line exists, is enforced, and that crossing it is a deliberate act.

## Decisions

1. **The boundary is a rule, checked in CI.** `src/core/**`, `src/providers/**` and `src/cache/**` import nothing from `wxt`, `src/entrypoints`, `src/ui`, `src/locales`, `src/config/storage`, `src/shared/messages` or `src/shared/transport`. Type-only imports are allowed — a type compiles away and binds nothing. `scripts/check-boundary.mjs` scans the tracked core files on every `pnpm lint`; a violation fails the build with the file and the specifier. The list of forbidden modules is the definition of "platform" for this repository.

2. **What the core shows a reader, the host supplies.** The core renders one reader-facing thing on its own — the failure widget's button and hover sentence — and gets those strings through `src/core/strings.ts` (`setCoreStrings` / `coreStrings`), with an English fallback until a host installs any. The extension's locale layer installs them when it loads and on every `setLocale`. A future host installs its own or keeps the fallback.

3. **The core answers with codes, the host with sentences.** A refused start is `{ started: false, reason: StartRefusal, detail? }` (`core/session`); the popup maps the code to the interface's sentence (`popup/view-model.ts:startRefusalText`). The same shape already holds for provider errors (`ProviderErrorKind` → `reasonText` in the UI) and for the fallback notice (`FallbackReason` → `fallbackText`). A new reader-facing condition in the core gets a code, never a sentence.

4. **Dependencies enter through the session and the providers, not through globals.** `createPageSession(deps)` is the core's front door for a host: the transport, the OCR call, the helper status, the configuration accessors, the locale hook and the trace sink are parameters. A host that has no background worker passes a transport that runs the chain in-page (`providers/transport.ts:createLocalTransport` already exists for that); one that has no helper passes an `ocr` that rejects. The content entry stays the one place that wires Chrome's pieces into those parameters (INVENTORY T2: splitting its orchestration is a separate change, on this side of the line).

5. **Not done now, on purpose.** No `@readarxiv/core` package, no second build target, no abstraction over `chrome.storage` beyond `config: { get, set }` — each would be code with one caller. The boundary check is the whole cost of keeping the option; the day a second host exists, extraction is moving directories the check has already kept clean.

## Consequences

- The core can be exercised without an extension runtime: the unit tests already do (WxtVitest fakes only what the platform layer touches), and a page-level harness for a second host would need the same five dependencies the content entry supplies today.
- `ui/strings.ts` gains one obligation (install the core strings) and the core gains one small module (`core/strings.ts`); `StartResult` changes shape on the `axt:translate-page` message — internal to the extension, no stored data involved (ADR-0001 §6).
- Adding a platform import to the core now fails lint. The right move is to widen a dependency of `createPageSession` or a provider, or to move the code to the platform side; the forbidden list changes only through an ADR.

## Verification

- `pnpm lint` runs `scripts/check-boundary.mjs`: 92 core files, no forbidden import, on the branch of this ADR.
- `tests/popup/view-model.test.ts` — `startRefusalText` (every code to its sentence in both locales) and `the core strings seam (ADR-0008)` (`setLocale` installs the retry label and the failure sentences); `tests/renderer/failed.test.ts` (the widget relabels on a locale switch); `tests/session/page-session.test.ts` (the refusal codes).
