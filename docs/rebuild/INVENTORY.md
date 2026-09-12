# Inventory of the MVP (v0.3.0-mvp)

What the code at the baseline actually does, what holds it together, and where the debt is — the evidence base the charter (§2) requires before any trade-off. Written 2026-09-12.

## How this was produced, and how to read it

Four read-only agents each read their slice of `main @ e6de3e1` in full (every file, not entry points), traced call sites with `grep -rlw`, and ran `git log -S` on every guard that looked redundant to find the commit, issue and test behind it. Their raw output is kept verbatim under `docs/rebuild/inventory/` (Chinese; 1 960 lines):

| Raw file | Scope | Size of the evidence |
|---|---|---|
| `inventory/core.md` | `src/core/**` (60 files, 7 721 lines) | module map 56 rows; **guard ledger 175 entries** (230 snippets checked); 60 debt candidates; 95 exports without a caller in `src/` |
| `inventory/runtime.md` | `src/entrypoints/background/**`, `providers/**`, `cache/**`, `config/**`, `shared/**`, `helper/**` (48 files, ~9 100 lines) | module map with port provenance; run paths a–e; **guard ledger 169 entries**; external contracts; 30 debt candidates |
| `inventory/ui.md` | content entry, popup, options, gallery, `ui/**`, styles, locales, e2e, CI | state model and all 17 message types; **66 controls with their test coverage**; CSS map; 20 guards (sampled); 12 debt candidates |
| `inventory/docs.md` | CLAUDE.md, DESIGN.md, RESEARCH.md, UI.md, THIRD_PARTY.md, agents, phase0, superpowers (5 529 lines) | ~58 claims contradicted by code, ~60 unverifiable, ~14 describing things that no longer exist; **37 contradictions**; 33 constraining rules rated, 6 marked must-keep |

The baseline is one merge later (#168, `8cfd771`); it touched `rules/latexml.ts`, `extractor/index.ts`, `renderer/{index,pending,failed}.ts`, `styles/modes.css`, so line numbers cited for those files are off by a few lines. The unit test count moved from 109 files / 1 518 tests to 111 / 1 546 for the same reason.

**Spot-checked against the baseline** (all confirmed): 18 code references to a DESIGN §8.6 that does not exist; `renderer/index.ts` is a barrel of 17 `export *` lines; `transport.ts:81` `revision` is a module-level counter compared in `popup/view-model.ts:159`; only `background/index.ts:43` and `content/index.ts:90` subscribe to `watchConfig`; the "real translation" selector `:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)` is written out 18 times across `src/` and `tests/`; `google-web.ts:13` hard-codes Google's public web-client API key; no `LICENSE` file exists; 14 files carry the Chinese GPL header and none the English one; `axt:ping` / `axt:stats` have no sender; `ACCESS_LIST`, `anchorWouldBreak`, `leadingLabel`, `THINKING_HOSTS` have no reference outside their own file.

One finding about the evidence itself, from the UI agent and confirmed by the other three: **the code comments are trustworthy.** Every "Codex pointed this out in #N" comment that was checked matched the commit history exactly. The guard ledgers can be read as first-hand material.

## 1. System map

Five execution contexts, compiled separately, talking over 17 `axt:*` message types (`src/shared/messages.ts`):

| Context | Entry | Holds | Lines |
|---|---|---|---|
| Content script (`arxiv.org/html/*`) | `entrypoints/content/index.ts` | the extracted `Block[]`, the running session (`progress`, `running`, `current`, `restarted`), the mode controller, the side-mode `prep` coalescer, highlight and image runs | 467 (the single assembly point of `core`; no unit tests) |
| Abstract page (`arxiv.org/abs/*`) | `entrypoints/abstract.content.ts` | nothing; injects one link; reads `config.uiLanguage` raw, bypassing `getConfig` to keep the bundle small | 30 |
| Background (MV3 service worker) | `entrypoints/background/index.ts` | the one provider chain for the whole browser (`active`), session↔tab↔transport routing, helper client, OCR service, install waiter, context menu | 285 + `sessions` 235, `helper` 285, `helper-await` 138, `ocr` 80, `context-menu` 113 |
| Popup | `entrypoints/popup/{data,view-model,PopupView}` | a snapshot of config read once at mount, polled `PageStatus` / `ProviderStatus`, its own `pack` and `helper` probes | 266 + 298 + 244 |
| Options | `entrypoints/options/**` | a second snapshot of config, second `pack` / `helper` probes, cache stats | 88 + 140 + sections |
| Helper (Swift, separate install) | `helper/Sources/axt-helper/main.swift` | Native Messaging stdio loop, Vision OCR | 167 |

`src/core/**` (60 files) is the pure-DOM part: `rules` (the only home of `ltx_*` selectors, `RULES_VERSION`), `extractor`, `protector` (placeholders, offsets, runs fallback), `renderer` (17 files, see §4.3), `scheduler`, `pipeline/run.ts` (the text pipeline's session), `image/run.ts` (the image pipeline's session), `sentences`, `svg`. Module-by-module responsibilities, exports and callers: `inventory/core.md` §1, `inventory/runtime.md` §1, `inventory/ui.md` §1.

### 1.1 Main run path (condensed; full table in `inventory/core.md` §2.1 and `inventory/runtime.md` §2a)

1. `document_idle`: `extract(document)` walks from `article.ltx_document` with `classify()` per element — skip / table / unit / protect(+descend) — producing `Block[]` in memory only; `paperContext()` pulls title + abstract once.
2. `start()`: config, `backend.status()`, mode controller (`side` falls back to `stack` under 1280 px), anchor fallback, hover highlight, session id, `prep.reset()`, then `startTranslation()`.
3. `startTranslation`: `enable()` writes `data-axt-on/mode/lang/dir` on `<html>` and injects one `<style data-axt-sheet>` built from four CSS files + appearance rules; all `data-axt-id` written synchronously; `data-axt-state="pending"` written in main-thread slices; `createLazyScheduler` seeds the first screen and observes the rest with an `IntersectionObserver` whose thresholds are quantised to 5 % and clamped to what the block can reach.
4. Per entered batch: `planBatches` (section / 1 000 chars / 4 segments; dense-void blocks alone; tables whole) → `serialize` (void placeholders for protected nodes, paired for inline elements; markers format flattens pairs; whitespace folded while recording `WireSpan` anchors) → `renderPending` (skeleton) → sentence cuts (tags path only) → `backend.translate` message.
5. Background: `router.forCall(scope, tabId)` → the chain (`buildChain`: preferred provider decides the wire format; free engines filtered by format and `isAvailable()`) → per-engine `TranslateService`: cache key = `sha256([CACHE_KEY_VERSION, cacheId ?? id, model, PROMPT_VERSION, promptKey, context, RULES_VERSION, target, renderPath, normalizedText, cuts])`, `readWithBudget` 2 s → misses go through `BatchQueue` → `RequestQueue` (token bucket, `maxConcurrent`, per-batch deadline, 429 pause / 401 drain) → provider → sentence markers removed, alignment verified, `admits()` placeholder check before the cache write → `FallbackService` demotes on failure (permanent for `no-key` / `auth`, 60 s otherwise).
6. Content: `validate` → `rehydrate` (clone slot nodes; `scanTokens` yields target-side offsets; markers path restores the leading label) → on failure `retrySingle(bypassCache)` → `viaRuns` → `renderFailed`. Success: `renderText` inserts a same-tag sibling with `axt-t`, `data-axt-for`, `lang`, `dir`, `data-axt-identity` when identical; `registerSentences` keyed by the translation node.
7. `prep.touch()` → coalescer (150 ms / 1 s) → one pass per dirty root: read column width / pair margins / margin-note positions → write notes, stale-split drop, (side) split figures, mirrors once per session → read table geometry → write fit buckets, margins, note offsets. This is the one deliberate write→read→write per pass (§6).
8. Mode switch writes `data-axt-mode`; `restore()` removes every `INJECTED_SELECTOR` node and `data-axt-*` attribute and the style sheet — the DOM-invariant guarded by `tests/renderer/restore.test.ts` and the e2e attribute sweep.

Branches: split figures (§2.2), sentence alignment / hover highlight / only-mode peek (§2.3), failure and retry (§2.4), image translation (§2.5), footnote localisation and margin-note stacking (§2.6) — all in `inventory/core.md`. Service-worker lifecycle handling (16 points, and the APIs deliberately not used: alarms, onStartup, onInstalled, long-lived ports): `inventory/runtime.md` §2c.

### 1.2 Versions that invalidate stored state

Six independent numbers: `PROMPT_VERSION = '4'`, `RULES_VERSION = '0.10.1'`, `CACHE_KEY_VERSION = 6`, `OCR_KEY_VERSION = 1`, `CONFIG_VERSION = 13`, helper `PROTOCOL = 1`. Each bump has a recorded reason (`inventory/runtime.md` C1, §2d). `CACHE_KEY_VERSION` 3→6 were all "old entries are now wrong", never "the key algorithm changed".

## 2. External contracts (charter §3 — migrate, never swap)

Full table with field shapes: `inventory/runtime.md` §4.

| Contract | Where | What breaks if changed casually |
|---|---|---|
| Saved configuration, schema v13 | `config/schema.ts:42-98`, `chrome.storage.local['config']` via WXT `defineItem` (+ WXT's own version side-key — name not yet confirmed, see §8) | any shape change without a migration + version bump makes `getConfig` fall back to defaults: the reader's API keys, services, prompts and appearance vanish (happened once, 0f1a760). `services[].apiKey` is the only place a secret lives. `abstract.content.ts:14` reads `config.uiLanguage` raw. |
| Appearance profiles | `config/appearance.ts:15-45` | built-in ids (`follow/green/blue/amber/muted/blur`, `soft-green/sand/sky`) are referenced by `resetBuiltIns`, the v12 migration and the style sheets |
| Dexie cache `axt-translation-cache` | `cache/store.ts:49-60` | index changes need a new Dexie version or open fails and the cache silently disappears; OCR results live in the same table. **Owner decision 2026-09-12: the cache is disposable** — a schema change may drop it, cost is re-translation. |
| Cache key payload | `cache/key.ts:77-92` | by design any encoding change invalidates everything; do it through the version number |
| Native Messaging protocol v1 | `helper/Sources/axt-helper/main.swift`, `shared/ocr.ts`, `background/helper.ts` | helper and extension are installed separately and can drift; a protocol change must bump `PROTOCOL` / `HELPER_PROTOCOL`, old helpers then fail the handshake with "reinstall"; `version` is part of the OCR cache key |
| Native host manifest | `helper/install*.sh`, `tests/e2e/image.mjs` | host name `io.github.srjoeee.arxivtranslate` and binary path are written into every installed reader's profile; renaming either orphans installed helpers |
| One-line installer | `ui/strings.ts:158-162` → `helper/install-remote.sh` | depends on repo `SRjoeee/ReadarXiv`, branch, `helper/` layout, SwiftPM product `axt-helper`, install dir `~/Library/Application Support/Readarxiv/helper` (note the third spelling — now a contract, §5.E) |
| Extension manifest | `wxt.config.ts:19-55` | adding a required permission disables the extension on update until accepted; `axt-toggle` is read by popup and context menu; `_locales` keys |
| `TranslationProvider` interface | `providers/types.ts:57-96` | `id` enters the cache key and `PageStatus.running.engine`; `WIRE_FORMATS` is read as data by the options page |
| GPL §5 attribution | file headers + `docs/THIRD_PARTY.md` | legal; see §5.E for the gaps |

## 3. Guard ledgers — what the odd branches are for

The ledgers are the most valuable artefact here: **364 entries** (core 175, runtime 169, UI 20 sampled), each with the introducing commit, the issue or Codex round, the problem it fixed (often with the paper it was seen on), and the test that guards it or "none". Before deleting or rewriting any guard, find its row.

Patterns worth knowing before redesign:

- **Most guards are empirical, not speculative.** Typical rows: `nodisplay` protect — ACM `\Description{}` leaked hundreds of hidden characters under a caption (2509.10652v3); `measureNatural` read-only — cloning to measure 392 equation tables produced a 45 s long task; `arm()` before `await probe()` — a hung probe silently stalled the install wait. Removing such a guard without its fixture is a regression, not a simplification.
- **Guards without tests** cluster in three places: `entrypoints/content/index.ts` (the `styleFromWatcher` gate, `restarted`, the session-id comparisons, `settleRaster`), `background/index.ts` (locale gate, sync `onClicked` registration — though `tests/entry/context-menu.test.ts` covers the latter), and numeric constants (rate limits, timeouts, thresholds). These are the rows to cover before touching their surroundings.
- **happy-dom shaped some production code**: `side-layout.ts:18,34-37`, `pair-margins.ts:55`, `skeleton.ts:50,82`, `style-values.ts:30` exist because the test DOM lacks `:is(.ltx_note *)`, returns empty strings, or lacks `CSS.supports`. They are test-environment accommodations living in `src/`.
- **Several guards are the same rule written in more than one place** (see §4.1): the fatal-error set, the "real translation" selector, the "scope cancelled" fact.

## 4. Debt register

Consolidated from the four raw lists, deduplicated, grouped by what the charter asks us to reduce. Each item names where the evidence is.

### 4.1 Duplicated state and duplicated decisions

| # | Fact held in more than one place | Copies | Evidence |
|---|---|---|---|
| S1 | The configuration | background `active.config` (subscribed), content closures (subscribed), popup `data.ts:62` (read once at mount + own writes echoed), options `data.ts:36` (same), `abstract.content.ts` (raw key read) | `ui.md` §2.2; `runtime.md` D5. Popup and options never see each other's edits; the assumption "the popup dies on blur" is implicit, written nowhere. |
| S2 | "Should this page translate or restore" | `popup/view-model.ts:181-189` vs `background/context-menu.ts:53-61 actionFor` (used by menu and `Alt+T`) | `ui.md` §2.2; a real divergence already shipped (b88485f: menu checked a state value that does not exist) |
| S3 | "This scope was cancelled" | `sessions.dropped`, one `cancelledScopes` registry per provider service, `ocr.cancelled`, content `halted()` — three data structures, each with its own `remember` semantics | `runtime.md` D2; dbe0ca4 was a fix for missing one copy |
| S4 | Which error kinds are fatal | `pipeline/run.ts:77`, `image/run.ts:31`, `content/index.ts:245`, `translate-service.ts:168 FATAL_FOR_QUEUE`, `fallback.ts:55 PERMANENT_KINDS` | `core.md` §4.1; `runtime.md` D3 — three layers each decide to "stop" |
| S5 | The "real translation" boundary `:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)` | 18 hand-written copies across `style-preset.ts`, `split-figures.ts`, `anchors.ts`, `notes.ts` (which omits two classes), two CSS files, e2e | `core.md` §4.1; issue #46 was a drift here; no test asserts the TS constants agree |
| S6 | Helper availability and the install wait | `helper.ts known/missing`, `helper-await.ts deadline` + session storage, content `helperReady`, popup and options `helper` state, each `HelperSetup` instance's `until` | `ui.md` §2.2, `runtime.md` D4; deliberate (popup dies on blur) but undocumented, so a rebuild could "fix" it and break the reconnect |
| S7 | Chrome language-pack state | popup `data.ts:64` and options `data.ts:38` each call `packState()`; no broadcast | `ui.md` §2.2 |
| S8 | Chain `revision` | module-level counter in `transport.ts:81`, echoed into `PageStatus.running.revision`, compared in `view-model.ts:159` to mean "page is behind the settings" — resets to 0 when the worker is recycled, so the popup misreports after a restart; untested | `runtime.md` D1 |
| S9 | Session validity | `scheduler/session.ts` singleton + 13 hand-written `getSessionId() !== session` checks in `content/index.ts`, plus `run.ts` `stopped`/`fatal`/`halted()`, plus `image/run.ts alive()` | `core.md` §4.3 |
| S10 | Literal class / attribute names beside their constants | `'.axt-t'`, `'axt-error'`, `'data-axt-inline'`, `'data-axt-'`, `'#axt-translate'` written out in `side-layout.ts`, `notes.ts`, `split-figures.ts`, `skeleton.ts`, `context.ts`, `content/index.ts:465` — mostly to dodge the renderer import cycle (§4.3) | `core.md` §4.1 |
| S11 | Small helpers re-implemented: seven text-extraction walkers with different exclusion sets (`rules/latexml.ts textOf`, `extractor ownText` / `cellText`, `context.ts text`, `renderer/index.ts ownText`, `protector/label.ts wireText`, `sentences visibleTextOf`, `svg/foreign.ts renderedText`); whitespace squashers ×7; `LETTER` regex ×4; `ELEMENT_NODE` constants ×4 | `core.md` §4.1 — DESIGN §4.1 defines one "translatable text"; the code has two definitions (`hasTranslatableText` is never called) |
| S12 | `BUILT_IN_PROMPT_DESCRIPTIONS` vs the same text in `locales/zh-CN.ts`; `LANG_CODE_TO_ZH_NAME` as `label()`'s default beside the locale packs | `runtime.md` D9, D26 |

### 4.2 Coexisting paths

| # | Two ways to do one thing | Evidence |
|---|---|---|
| P1 | **Text pipeline and image pipeline are two state machines of the same shape** (`pipeline/run.ts` vs `image/run.ts`: Outcome, progress, fatal, claim, stop, `translate(picked)`), each reporting its own `Progress` type; deliberate (bitmaps are not `Block`s) but the largest duplication in `core` | `core.md` §4.1 |
| P2 | `markBlocks` (only `#axt-debug`) vs `run.ts:145` writing `data-axt-id` directly — DESIGN §4.1 describes the path nobody takes | `core.md` §4.2 |
| P3 | `clearPending` / `clearFailed` / `alignPairMargins` / `isSideContainer` / `splitSentences` — second entry points that production never calls; only tests do | `core.md` §4.2, §1.6 |
| P4 | Waiting for the chain to reflect a saved config: `shared/chain.ts awaitChain` polls `provider-status` ten times, while `ServiceDrawer` sends `axt:engine-ready` and awaits the reply — because `watchConfig`-triggered rebuilds have no acknowledgement | `runtime.md` D25 |
| P5 | `helper/install.sh` vs `helper/install-remote.sh`: two writers of the same host manifest with different descriptions, binary paths and `allowed_origins` policies (overwrite vs union) | `runtime.md` D11 |
| P6 | Config evolution by zod `.default()` (`reading`, `uiLanguage`, …) **and** by versioned migrations — the version number no longer says what shape is stored | `runtime.md` D29, §2d |
| P7 | `getProvider`'s `default` branch mapping unknown ids to microsoft **and** `ServiceDrawer.remove` resetting `provider` — same case handled twice | `runtime.md` D28 |
| P8 | Deleting things: `ui/Confirm.tsx` two-step (services, profiles, cache) vs `window.confirm()` in `PromptManager.tsx:65`; `PromptManager.tsx` is also the one options file styled with inline objects instead of Tailwind | `ui.md` §7 |
| P9 | `scanTokens` vs `tokenize` — deliberate parallel implementation (hot path kept separate), guarded by an equivalence test over every fixture; keep, but it is two tokenizers | `core.md` §4.1 |

### 4.3 Structure

| # | Finding | Evidence |
|---|---|---|
| T1 | **`renderer/index.ts` is both the rendering core and a barrel** (17 `export *`), and ten renderer modules import `./index` back: ten `index ↔ X` cycles. Symptoms: `notes.ts:164-166` builds a constant inside a function body to dodge module-init `undefined`; `marks.ts` was hoisted to `core/` to escape the cycle; most of the literal-vs-constant duplication in S10 | `core.md` §4.3 |
| T2 | `entrypoints/content/index.ts` (467 lines) wires 13 `core` entry points and owns seven handles (`run`, `images`, `modes`, `prep`, `highlight`, `title`, `uninstallAnchors`); its state (`progress`, `running`, `current`, `restarted`, `styleFromWatcher`, `resumeRaster`) is consistent with `core`'s only by construction — **no test covers this layer** (`tests/entry/` covers the abstract page and the context menu) | `core.md` §5.10, `ui.md` §7 |
| T3 | The hover highlight layer and the peek panel have two owners: created by the controller, deleted by module-level `clearSentenceHighlights` (called from `setMode` / `restore` / `applyStyle`), with the controller detecting the deletion through an `epoch` counter and `panel.isConnected` | `core.md` §4.3 |
| T4 | The same translation is `validate`d up to three times: `translate-service` before the cache write, `run.ts` before `rehydrate`, `rehydrate` again | `core.md` §4.3 |
| T5 | `applyStyle` rewrites the whole injected sheet (`modes` 531 + `presets` 68 + `image` 102 + `highlight` 76 lines) for a colour change; the four CSS files are only complete when read together with the renderer's concatenation order | `core.md` §4.3, `ui.md` §4.4 |
| T6 | `ProtectedBlock.root` and `slots` hold DOM references; `rehydrate.test.ts:41` carries a known defect marked "pending A03" (a node replaced after serialisation is still the one put back) | `core.md` §4.3 |

### 4.4 Dead and unused code

- **`src/core`: 95 exports with no caller outside their own file** (`inventory/core.md` §1.6 — a count of external references, not of dead code), in four classes: referenced nowhere else at all (`ACCESS_LIST`, `anchorWouldBreak`; `sentenceMapOf` has one test) — deletion candidates; **used inside their own file and merely over-exported** (`setAppearanceAttrs`, `NARROW_QUERY`, `DEFAULT_WALK_BUDGET_MS`, `INLINE_TITLE_MAX_CHARS`, `DOCUMENT_SUBTITLE`, `NAMED_TAGS`, `leadingLabel`, several constants and ~25 types) — narrow the export, never delete without checking the internal callers; exported only for tests (the P3 second entry points, seven `skeleton.ts` helpers, five `image/run.ts` utilities); and barrel pass-throughs nobody imports.
- **Runtime** (`inventory/runtime.md` §1.7–1.8): `SessionRouter.rebindAll` (replaced by `dropAndRebindAll`, tests only), `BUILT_IN_PROMPT_IDS`, `THINKING_HOSTS`, `isRtl` / `RTL_LANGUAGES`, `providers/index.ts:87-89` re-exports (zero importers), `TranslationProvider.displayName` and the three `displayName` fields in status types (the UI uses `serviceName(id)`; only a `console.warn` reads them), `HelperClient.ocr(langs)` never passed.
- **Ported queue code never executed here, ~250 of ~1 700 lines**: `setQueueOptions`, `setBatchConfig`, `markPrefix` + prefix table, `isRateLimitRequestError`, the `RetryAwareError` multi-shape branches (our providers all attach metadata explicitly), `RequestTask.createdAt` (duplicate of `enqueuedAt`), `PendingBatch.id` (generated, never read). `request/config.ts` exists half for the two unused hot-update entry points.
- **Protocol with no sender**: `axt:ping`, `axt:stats` (and their `case` branches); UI.md §8 claims the gallery shows them — `gallery/main.tsx` does not.
- **UI**: locale key `O.services.apiKeyStored` (the drawer hard-codes `'••••••••'`); e2e helper `chooseService()` never called; two orphaned JSDoc blocks in `ui/strings.ts:114-119`.
- **Dangling comments** left by deleted code: `rules/latexml.ts` ×6 (`:149-157` describes a constant removed in 5a6fb3e), `serialize.ts:44-46`, `offsets.ts:211-226` (duplicated JSDoc), `label.ts:131-134`, `rehydrate.ts:8-34`, `style-preset.ts:18-20`, `chrome-builtin.ts:147-148`; stale comments asserting old facts: `renderer/sentences.ts:109` ("only Microsoft reports boundaries"), `translate-service.ts:1-5` ("runs on the content side"), `openai-compat.ts:62`, `types.ts:33` ("target: BCP-47"), `wxt.config.ts:4` ("Phase 3"), `tests/providers/prompt.test.ts:32` (test name says version 3).

### 4.5 Test coverage gaps (charter §6 — know what is unprotected before moving it)

- `entrypoints/options/**`: **zero unit tests** (no `@testing-library/react` in the repo); six e2e scripts cover parts. Never exercised by any test: `ProfileEditor.tsx` (colour, opacity, underline, blur, advanced CSS, duplicate, delete), the highlight-profile grid, the glossary textarea, `PromptManager` edit / import / export / token insertion, `ServiceDrawer` "more options / thinking" and **"delete service"**.
- Popup: the service / language / prompt menus are covered only by the pure `derivePopupView` tests; no e2e clicks through them (the options-page equivalents are clicked instead), so the popup-specific menu placement (`Menu.tsx MIN_BELOW`) is unverified by automation.
- `entrypoints/content/index.ts`, `popup/data.ts`, `options/data.ts`: not under vitest at all; their guards (serialised config writes, `styleFromWatcher`, `wanted` ref, `restarted`) have no assertions.
- **CI runs no e2e** (`ci.yml`: typecheck → lint → test → build, ~2 min). The 67 browser tests plus layout / a11y / local-endpoint / image / placeholders are a manual safety net. `e2e:image` needs macOS and an installed helper.
- Performance claims in DESIGN (213 ms/session prep, 12.3 ms extract, long-task budget in `layout.mjs`) exist, but nothing measures the highlight `MutationObserver` during translation bursts or `lazy.ts release()` at 880 blocks.

### 4.6 Documentation (the part Phase 2 was explicitly asked to clean)

- **"DESIGN.md is the single source of truth" is refuted by the code** it describes: default mode is `side` (doc: `stack`), default service `microsoft` (UI.md §7 still proposes `google-web`), `CACHE_KEY_VERSION` 6 (doc: 4), config v13 (doc: v12), §8.3 "instant engine" marked [decided] was never implemented, §8.4 `FallbackService.reset()` does not exist (§8.5 says so), §7.1's attribute list (three) vs the six-plus the code writes, §5.2 lists protect rules under "skip", §8.0 "content sends three messages" (it sends more), §10 "markers are sliced" (they are not, #67). Full list: `inventory/docs.md` §2 (❌ rows) and §3 (37 contradictions).
- **A whole design lives only in code comments**: 18 references to "§8.6" (sentence alignment, sentence markers, why `CACHE_KEY_VERSION` went 5→6). Reconstruct it into an ADR from `cache/key.ts:49-65`, `providers/{alignment,sentence-markers}.ts`, `translate-service.ts:244-261`, `core/sentences/index.ts`.
- **SVG conclusion unsynchronised in three places** (RESEARCH §2.9, §6.11; DESIGN §5.2, §15.1 say "no translatable text") after §15.6 wired 199 TikZ labels.
- **RESEARCH §7 revision table** (27 rows): 19 done, 4 superseded by better designs, 2 point the wrong way (rows 16, 21), 2 marked obsolete — none carry a status marker.
- **UI.md**: §8's requirement ids no longer match §3 after renumbering; "draft / [议]" labels on sections that shipped; §9 open questions already decided.
- **CLAUDE.md** (now rewritten on this branch) was half stale: wrong directory tree, provider file names, AI SDK packages, `createShadowRootUi` never used, `preservesMarkup` replaced by `wireFormats`, `google-gtx` never built, "fixtures:stats to be created" (exists), seven missing scripts, the finished Phase 0 list, and three `docs/agents/*` files that are unmodified generic templates (`CONTEXT.md`, `docs/adr/`, `/wayfinder` never existed here).
- **GPL §5 gaps** (legal — fix before anything else in docs): no `LICENSE` at the repo root while DESIGN §13 claims GPL-3.0; two header templates (CLAUDE.md English vs DESIGN §13 Chinese; all 14–26 actual headers Chinese); files whose headers claim a source but are missing from `THIRD_PARTY.md` (`providers/thinking.ts`, `providers/glossary.ts`, `providers/request/config.ts`, `scheduler/lazy.ts`, `scheduler/title.ts`, `config/storage.ts`); DESIGN §15.1 says the image overlay was ported from ImageTrans, `renderer/image.ts` / `image/boxes.ts` carry no header and THIRD_PARTY has no file row — either the doc is wrong or the registration is missing.
- **Five spellings of the name**: manifest `Read arXiv`; repo `ReadarXiv`; `package.json` `arxiv-html-translator` (version 0.0.0, no `license`, no `description`); install dir and helper description `Readarxiv`; host name `io.github.srjoeee.arxivtranslate`; CLAUDE.md / DESIGN.md / `Package.swift` still "arXiv HTML Translator"; `docs/phase0/rules-audit.md` commits a local absolute path. The host name and the install dir are contracts (§2) and stay; the rest is cleanup.
- **Obsolete artefacts**: `docs/superpowers/**` (executed plans, 2 257 lines, one references a git-ignored canvas file); `docs/phase0/rules-audit.md` (generated at RULES_VERSION 0.4.0, regenerable with `pnpm fixtures:stats`).

## 5. Decisions this inventory puts in front of the owner

Everything above the line the rebuild can act on under the charter's autonomy; these five touch product promises, legal status or installed readers.

*Resolved 2026-09-12 (kept here for the record):* A — exemption recorded, ADR-0001 §10. B — independent implementation (compared function by function against `reference/ImageTrans_chrome_extension@ef11ca7`); DESIGN §15.1 corrected, nothing to attribute. C — the owner handles LICENSE / README on the `docs/readme` branch; the rebuild stays on the code side. D — the spelling stays, ADR-0001 §6. E — ADR-0002: optional permission requested on the install gesture; OCR behind one backend interface.

- **A. `google-web.ts:13` hard-codes a Google API key** (the public key of Google's own web translator, inherited from KISS Translator). Hard rule 5 reads "API keys never enter git". Proposed reading: this is a public constant of a third-party client, not a secret of ours or of a reader; record the exemption next to the rule. Alternative: load it at runtime — which changes nothing about its exposure.
- **B. ImageTrans provenance.** Either `renderer/image.ts` / `image/boxes.ts` port code from a GPL project and need the header + registry row, or DESIGN §15.1 is wrong and must be corrected. `reference/` is git-ignored so the comparison has to be done by whoever has the checkout.
- **C. `LICENSE`.** The repo states GPL-3.0 everywhere but ships no license file (#167 backlog). This should land before any public-facing step.
- **D. The install directory `~/Library/Application Support/Readarxiv/helper`** is misspelled relative to the repository name but is now written into installed readers' manifests. Keep as-is (contract) or migrate with a one-time move in the installer?
- **E. `nativeMessaging` as a required permission** — DESIGN §15.4 said "make optional at distribution time". The rebuild is the moment to decide.

## 6. Performance-sensitive points (charter §6: measure before claiming)

From `inventory/core.md` §4.5 and `inventory/runtime.md` D16. Each is a place where a rebuild must either keep the existing measurement or take a new one:

| Where | Shape | Known numbers |
|---|---|---|
| `renderer/prep.ts:74-138` | one write→read→write per pass; forced layout lands on `fitTables` | DESIGN §7.2: 213 ms/session after the incremental rewrite (#46), down from 1.9 s full rescans |
| `renderer/highlight.ts:544-571` | body-level `MutationObserver` (attributes + characterData) doing `closest` + ancestor lookups per record during translation bursts | **none** |
| `renderer/index.ts:256-259 renderTable` | O(cells²) — `querySelectorAll` per cell to survive nested-table replacement | none |
| `scheduler/lazy.ts:144-148 release()` | O(N²) over a session (`includes` inside a nested loop) | none; 880 blocks ≈ 7.7×10⁵ `includes` |
| `cache/index.ts:15-17 putMany` | one Dexie transaction per segment (a 100-segment batch = 100 transactions) | none |
| `renderer/mirror.ts:51` | full-page `:has()` scan + repeated `matches` | DESIGN §7.2: 30 ms + 138 ms first style computation, accepted |
| `protector/tokens.ts` | two explicit loops kept separate on purpose | 1 645 → 1 833 ms regression when merged (99c3cad) |
| `table-fit.ts` | read-only measurement, cached by column width + translation node | 45 s long task before (2b43f7d); 991 ms over 31 passes before caching (ef4350b) |

The baseline gate on the untouched code: typecheck 2 s, lint 2 s, unit tests 22 s (1 546), build < 1 s warm, bundle 1.25 MB, `pnpm e2e` 67/67 in 181 s. Browser-suite timings and the long-task budget go to `BASELINE.md`.

## 7. What holds up

Not everything is debt, and the charter says to keep what carries value. The inventories were consistent about these:

- `core/rules` → `extractor` → `protector` → `renderer`: the DOM invariant is real, tested (`restore.test.ts`, e2e attribute sweep, `selector-boundary.test.ts`) and has survived 12 fixtures and 40+ Codex rounds; its guards are each tied to a paper.
- The request layer's behaviour under 429 / 401 / timeouts / cancellation is thoroughly guarded (`concurrency-cap`, `queue-cancellation`, `retry-policy`, `translate-service` suites) — the code is larger than it needs to be (§4.4), not wrong.
- The session router's navigation grace and probe logic (`sessions.ts`) encodes hard-won cases (#142, #143, #157) with a test per case.
- Comment discipline: every odd branch says which round found it, and the history agrees.

## 8. Open questions the agents could not settle

Merged from the four "unverified" sections; each is a probe to run, not a guess to make.

1. WXT `defineItem` version side-key name — part of the saved-config contract.
2. `revision` misreport after a worker restart (S8) — reproduce: translate, idle 30 s+, reopen the popup.
3. `sessions.ts:126-128` — the comment's reason (tasks survive a worker restart) does not match the memory model; what is the branch really for?
4. Cost of the highlight `MutationObserver` during a translation burst; cost of `lazy.ts release()` at 880 blocks; cost of `putMany` per batch — none measured.
5. `.ltx_note` descend → protect-as-void → `localizeNotes` copy: a three-module chain with no test stating it as an invariant; does the rebuild keep the footnote design?
6. `renderTable` cell registration: does `sentenceMapAt` always resolve to the cell when the table itself is unregistered?
7. `PlaceholderIntegrityError` from `rehydrate` appears unreachable in production (validated first) — pure defence or a live path?
8. 131 vs 138: manifest minimum is 131 (anchor positioning); the built-in translator needs 138 and is feature-detected — behaviour and popup wording on 131–137 never checked.
9. Microsoft's supported-language table is a 2026-09-08 snapshot with no automated check; Google's public key validity is only proven by e2e.
10. `google-web.ts` batch planning uses the preferred engine's `maxBatchChars` even after demotion to `chrome-builtin` (20 items) — accepted by design or an oversight?
11. `data-axt-fit` is written on the original table — allowed by CLAUDE.md's wording of the invariant, not by DESIGN §7.1's list.
12. Whether the 5 popup fixtures P0–P16 in UI.md §4 still match `derivePopupView` one-to-one.
