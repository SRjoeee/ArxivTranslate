# ADR-0003: An acyclic renderer with an explicit surface

- Status: accepted (2026-09-12); first structural change of the rebuild
- Evidence: `docs/rebuild/INVENTORY.md` T1, S5, S10; `inventory/core.md` §4.1, §4.3

## Context

`src/core/renderer/index.ts` was two things at once: the block-level rendering core (`renderText`, `renderTable`, `restore`, the `data-axt-*` attribute names) and a barrel re-exporting all sixteen sibling modules with `export *`. Ten siblings imported constants or functions back from `./index`, so the module graph had ten `index ↔ X` cycles. The cycles had visible costs: `notes.ts` assembled a selector inside a function body because reading the constants at module-initialisation time hit `undefined` on the cycle; `core/marks.ts` was hoisted out of the renderer to escape it; six places wrote `'axt-error'`, `'.axt-t'`, `'[data-axt-split]'`, `'data-axt-inline'`, `'data-axt-'` as literals instead of importing the constant; and the "real translation" boundary `:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)` existed as eighteen hand-written copies (one of which, in `notes.ts`, silently lists only two of the four classes), with issue #46 as the recorded drift. The `export *` barrel also made ninety-five renderer symbols public through one façade, which is why "is this export used?" had no cheap answer.

## Decisions

1. **Names are leaves.** `renderer/attrs.ts` holds every `data-axt-*` attribute name, every injected sub-class (`axt-pending`, `axt-error`, `axt-mirror`, `axt-split`, `axt-note-t`, `axt-note-s`), the `Mode` / `BlockState` types, and the **one** definition of the translation boundary (`TRANSLATION_EXCLUDED_CLASSES`, `REAL_TRANSLATION`). It imports nothing from the renderer. A module never imports a sibling only to read a constant.
2. **The core is split by what it touches.** `shell.ts` builds a block's translation container (`translationShell`, `translationClass`, `shouldInline`); `translation.ts` owns a block's translation node (`setState`, `markPartial`, `clearTranslation`, `renderText`, `renderTable`); `page.ts` owns the document (`enable`, `setMode`, `applyStyle`, `appearanceSheet`, `restore`). Each depends only on layers below it: attrs and `core/marks` → shell / skeleton / style-preset / sentences → translation / notes / mirror / split-figures / table-fit / pair-margins / margin-notes / image / anchors → pending / failed / prep / highlight → page → responsive.
3. **`index.ts` is a façade, not a barrel.** It re-exports exactly the names production code outside the renderer uses (the content entry, the pipeline, the popup, the appearance UI, the debug entry); nothing inside `src/core/renderer/` imports it. Tests import the module that defines what they test.
4. **A test guards the graph** (`tests/renderer/module-graph.test.ts`): no renderer module imports `./index`, and the sibling-import graph has no cycle. A second test asserts that every `.axt-t:not(…)` in the style sheets lists the same classes as `TRANSLATION_EXCLUDED_CLASSES`, so the CSS cannot drift from the TypeScript definition.
5. **Literals become the constant they stand for**, including `'axt-'` in `extractor/context.ts` (`AXT_CLASS_PREFIX` in `core/marks.ts`) and `'#axt-translate'` in the content entry (`AUTO_TRANSLATE_HASH` from `core/abstract/link.ts`).

Behaviour is unchanged by construction: no function body changes except where a literal is replaced by the constant with the same value. The unit suite (1 546), the browser suites and the layout budget are the acceptance.

## Consequences

- The renderer's public surface is a list one can read; growing it is a deliberate edit to `index.ts`.
- `INVENTORY.md` §4.4's "over-exported internals" shrink to what tests import by path; the remaining deletion candidates (`anchorWouldBreak`, `sentenceMapOf`, the second entry points in P3) are decided separately, on their own evidence.
- The same pattern — leaf names, layered modules, a façade guarded by a graph test — is the template for `core/pipeline`, `core/image` and the background when their turn comes.
