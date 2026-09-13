<!-- Raw inventory written by a read-only agent on 2026-09-12 against main @ e6de3e1 — one merge before the v0.3.0-mvp baseline (8cfd771). PR #168 later touched src/core/rules/latexml.ts, src/core/extractor/index.ts, src/core/renderer/{index,pending,failed}.ts and src/styles/modes.css, so line numbers in those files have shifted slightly. Kept as the evidence behind docs/rebuild/INVENTORY.md, which lists the claims that were spot-checked; translated from the Chinese original into English on 2026-09-13 (the owner's decision that the repository speaks English), content unchanged. Delete this file when the rebuild retires the code it describes. -->

# docs audit — started 2026-09-11T20:36:20Z

Worktree HEAD=e6de3e1 == origin/main, clean.

## 1. Document map

| File | Lines | Purpose | Last substantive change | Cited by (file name / section number) |
|---|---|---|---|---|
| `CLAUDE.md` | 220 | Project-level agent instructions: stack, directories, hard rules, porting boundary, workflow, Phase 0 tasks, commands, agent skills | `ed456b3 2026-09-09 docs: qualify the run counts…` | DESIGN.md, RESEARCH.md, the three superpowers plans/specs; 8 code comments (`config/schema.ts`, `config/services.ts`, `core/marks.ts`, `renderer/side-layout.ts`, `rules/latexml.ts`, `scheduler/title.ts`, `providers/microsoft.ts`, `tests/rules/selector-boundary.test.ts`, mostly citing “hard rule N”) |
| `CONTEXT.md` | **does not exist** | The “repository-root CONTEXT.md + docs/adr/” that CLAUDE.md §Domain docs and `docs/agents/domain.md` claim | — | Mentioned only by CLAUDE.md and docs/agents/domain.md; the `docs/adr/` directory does not exist either |
| `docs/DESIGN.md` | 1015 | The single source of truth (self-declared): scope, block model, rules, placeholders, three-mode rendering, providers, cache, scheduling, tests, phase plan, image translation | `7b6ab60 2026-09-12 docs(design): the guided install moves into the popup…` | About **560** `§N.N` citations in code / tests (§7.1 58, §7.2 30, §15.5 29, §10 25, §8.6 18…), covering nearly every module under src; `helper/README.md` and `helper/main.swift` cite it too |
| `docs/RESEARCH.md` | 767 | Phase 0 measured conclusions + later measurements (selector corrections, reference file map, endpoint survival, Translator API, MV3 survival, CORS, SVG glyphs) | `265689e 2026-09-09 docs(research): say what the space-glyph ratio…` | Cited heavily by DESIGN.md; code `rules/latexml.ts`, `svg/glyphs.ts`, `svg/runs.ts`, `google-web.ts`, `renderer/responsive.ts`; `tests/fixtures/arxiv/README.md`, `tests/rules/latexml.test.ts` |
| `docs/UI.md` | 382 | The UI contract (popup / settings page / language / state machine / requirement ids S-P-xx etc.) | `b053887 2026-09-12 docs(ui): the displayed name keeps its space…` | DESIGN.md §4.0b, two plans, the spec; 30 code sites (popup / options / locales / ui / strings / e2e) citing `UI.md §N` |
| `docs/THIRD_PARTY.md` | 38 | The GPL §5 attribution register | `020e42e 2026-09-11 feat(renderer): a skeleton…` | CLAUDE.md, DESIGN.md §12/§13, `styles/presets.css` |
| `docs/agents/codex-review.md` | 83 | The Codex review process and its signals | `67711a5 2026-09-09 docs: size PRs by measured review cost…` | CLAUDE.md, the popup plan |
| `docs/agents/domain.md` | 51 | The domain document layout (CONTEXT.md + ADR) | `eccef7a 2026-09-03 “初始提交”` (the initial commit; never changed since) | Only CLAUDE.md |
| `docs/agents/issue-tracker.md` | 45 | How GitHub Issues are used | `eccef7a 2026-09-03 “初始提交”` (the initial commit) | Only CLAUDE.md |
| `docs/agents/triage-labels.md` | 15 | The five triage labels | `eccef7a 2026-09-03 “初始提交”` (the initial commit) | Only CLAUDE.md |
| `docs/phase0/rules-audit.md` | 656 | The generated report of the Phase 0 rule coverage audit script | `c38ddf0 2026-09-04 fix(rules): stop double-translating…` | CLAUDE.md, RESEARCH.md |
| `docs/superpowers/plans/2026-09-07-popup-ui.md` | 1447 | The popup rebuild implementation plan (for the Phase 1 UI integration branch) | `cc48ee1 2026-09-10 docs(ui): sync the contract and plan…` | Cited by nobody |
| `docs/superpowers/plans/2026-09-10-settings-services-appearance.md` | 587 | The settings page (services + appearance) implementation plan | `bfaa3b2 2026-09-10` | UI.md cites its spec |
| `docs/superpowers/specs/2026-09-10-settings-services-appearance-design.md` | 223 | The settings page design spec | `b3458da 2026-09-10` | UI.md, the matching plan |
| `docs/brand/store-icon-128.png` | binary | The store icon | `a9473c5 2026-09-11` | — |

Markdown total 5529 lines. The `docs/` in CLAUDE.md's directory tree lists only `DESIGN.md RESEARCH.md`; UI.md / THIRD_PARTY.md / agents / phase0 / superpowers are all unregistered.

<!-- section 1 done -->

## 2. Claim checks

Legend: ✅ agrees with the code · ❌ disagrees with the code · ⚠️ cannot be verified / partly holds · 🗑 what it describes no longer exists. Line numbers refer to the files at HEAD e6de3e1.

### 2.0 CLAUDE.md

| Location | Claim | Status | Evidence |
|---|---|---|---|
| L1 | The title “arXiv HTML Translator” | ❌ | The product name is settled as Read arXiv (UI.md S-P-01, `wxt.config.ts:21` manifest `name: 'Read arXiv'`); `package.json` is still `arxiv-html-translator@0.0.0` |
| L6 | RESEARCH.md “holds the Phase 0 measured conclusions” | ⚠️ | The second half of RESEARCH.md (§5.1, §6.4–6.11) is later measurement from 2026-09-05 to 09-09, long past Phase 0 |
| L16 | LLM calls: `@ai-sdk/openai-compatible` / `@ai-sdk/anthropic` / `@ai-sdk/google` | ❌ | `package.json` has only `ai` + `@ai-sdk/openai-compatible`; DESIGN §8.1 decided anthropic / gemini are not implemented |
| L14–24 stack table | Tailwind not mentioned | ❌ | `tailwindcss` + `@tailwindcss/vite` are in devDependencies, `wxt.config.ts` loads the plugin, popup / options use it throughout |
| L15 | The overlay injected into the page uses WXT `createShadowRootUi` | ❌ | No `createShadowRootUi` call anywhere in `src/`; only `renderer/failed.ts` uses native `attachShadow` (DESIGN §12 PR 2b states “switched to a few dozen lines of native DOM + Shadow DOM”) |
| L18 | Queues ported from Read Frog `utils/request/` | ✅ | `src/providers/request/{request-queue,batch-queue,retry-policy,priority-queue,cancellation}.ts` carry attribution headers |
| L19 | Cache on Dexie, ported from FluentRead | ✅ | The file header of `src/cache/store.ts` |
| L22 | `@types/dom-chromium-ai` | ✅ | devDependencies |
| L24 | Biome linter only; `src/providers/request/**` override | ✅ | `biome.json` 676 bytes, the override not examined in detail (⚠️) |
| L26 | “Browser target Chrome 138+” (the reminder's copy of CLAUDE.md has this sentence; the HEAD copy does not) | ⚠️ | The HEAD CLAUDE.md lacks the sentence; DESIGN §8.1 says built-in translation needs 138+, the manifest says `minimum_chrome_version: '131'` — two numbers side by side, and the documents never explain “131 installs but built-in translation is unavailable” |
| L33–58 directory structure | `entrypoints/content.ts`, `background.ts` | ❌ | Actually `entrypoints/content/{index,debug}.ts`, `entrypoints/background/{index,context-menu,helper,helper-await,ocr,sessions}.ts`, plus `abstract.content.ts` and `gallery/` |
| Same | `providers/openai-compat.ts anthropic.ts gemini.ts chrome-builtin.ts google-gtx.ts` | ❌ | Actually `openai-compat.ts chrome-builtin.ts google-web.ts microsoft.ts`; no anthropic / gemini / google-gtx |
| Same | Not listed: `core/image/`, `core/svg/`, `core/sentences/`, `core/pipeline/`, `core/abstract/`, `core/marks.ts`, `shared/`, `ui/`, `locales/`, `helper/` (Swift), `scripts/`, `styles/{highlight,image,ui}.css` | ❌ | All exist (see the map in §1); the tree reflects the pre-Phase-1 plan |
| Same | `docs/ DESIGN.md RESEARCH.md` | ❌ | There are also UI.md, THIRD_PARTY.md, agents/, phase0/, superpowers/, brand/ |
| L65 hard rule 1 | An original node may only gain `data-axt-*`; global state only on `<html>` | ✅ | `renderer/index.ts` `restore()`; §7.7 already records “the band layer / hover panel hang on `<body>`” as a relaxation |
| L66 hard rule 2 | `ltx_*` only in `rules/latexml.ts` + `styles/*.css` | ✅ | Guarded by the scan in `tests/rules/selector-boundary.test.ts` |
| L67 hard rule 3 | The provider's `preservesMarkup` decides markup / runs | ❌ | The field became `wireFormats: readonly WireFormat[]` long ago (`providers/types.ts:66`), with three paths tags / markers / runs (DESIGN §2.3); `preservesMarkup` no longer exists in `src/` |
| L68 hard rule 4 | `chrome-builtin`, `google-gtx` each in its own file | ❌ | `google-gtx` was never implemented; now `google-web.ts` + `microsoft.ts` |
| L70 hard rule 6 | The cache key holds `providerId | model | PROMPT_VERSION | RULES_VERSION | target | renderPath | normalizedText` | ⚠️ | The real key also holds `CACHE_KEY_VERSION | promptKey | context` (`cache/key.ts:1,70-88`); “must include” still holds, the list is incomplete |
| L71 hard rule 7 | API keys live only in WXT storage | ✅ | The comment at `config/schema.ts:46`, `cache/key.ts` |
| L80 | protector “Phase 1 / 2 completed” | ✅ | — |
| L81 | The attribution template is the English `// Ported from …` | ❌ | All 26 files with an attribution line use the Chinese template `// 移植自 …`, 0 English; the line itself admits “existing files switch at their next substantive change” — contradicting the Chinese template at DESIGN §13 L863 (see §3) |
| L88 | “A module over 100 lines starts in plan mode” | ⚠️ | A process rule, not verifiable from code; see §4 |
| L89–107 | The PR size and Codex round statistics table | ⚠️ | Historical data (2026-09-08), kept in CLAUDE.md as the basis of a rule |
| L139 | The gate `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | ✅ | All four scripts are in `package.json`; `.github/` has CI (not examined in detail) |
| L141–142 | “On a [待验证] item, measure first and write it into RESEARCH.md” | ⚠️ | DESIGN.md has **no** `[待验证]` marker left (grep hits only the legend at L6); RESEARCH.md has 2 unclosed ones (see the end of §2.1) |
| L164–181 Phase 0 tasks | Seven tasks | 🗑 | RESEARCH.md L3 “Phase 0 tasks 1–7 all completed”; DESIGN §12 marks them done too |
| L173 | “Count the share of SVG figures along the way (see DESIGN.md §15.1)” | 🗑 | Done (RESEARCH §2.9), and the conclusion was later overturned and widened by §6.11 / §15.5 / §15.6 |
| L199 | `pnpm fixtures:stats # the Phase 0 class-name histogram script (to be created)` | ❌ | The script `scripts/fixtures-stats.ts` has long existed and been re-run repeatedly (RESEARCH §2.11) |
| L187–200 commands | Missing `e2e:image`, `e2e:placeholders`, `helper:build`, `helper:smoke`, `icons`, `check:output`, `zip` | ❌ | `package.json` scripts |
| L208 | Issue tracker: `docs/agents/issue-tracker.md` | ⚠️ | The file is the generic mattpocock skills template (mentions `/wayfinder`, `/triage`, the `wayfinder:map` label), never rewritten for this repository |
| L216 | The five triage labels | ⚠️ | Cannot verify whether the labels were really created on GitHub (no network access this time); the file is a template too |
| L220 | “Single-context layout: repository-root `CONTEXT.md` + `docs/adr/`” | 🗑 | Neither exists; `domain.md` itself says “skip silently if absent” |

Addendum: the differences between the reminder's CLAUDE.md (an older copy) and HEAD — the old copy has the “browser target Chrome 138+” paragraph, “no cross-browser fallback branches”, a three-step gate and the Chinese attribution template; the HEAD copy adds the PR size table, the four-step gate, the English rule and the English template. The owner's memory also records “the CLAUDE.md in the reminder is the old copy”.

<!-- section 2.0 done -->

### 2.1 DESIGN.md §0–§6 (header, scope, core judgements, terms, architecture, rules, placeholders)

| Location | Claim | Status | Evidence |
|---|---|---|---|
| L1 | The title “arXiv HTML Translator — design document” | ❌ | The product name is Read arXiv (`wxt.config.ts:21`, UI.md S-P-01) |
| L3 | “Version v0.6 · 2026-09-04 · Phase 3 in progress; v0.6 moves provider requests to content” | ❌ | The header has not been updated since 09-04; the body §8.0 (09-06) moved the requests back to the background while the header still says “moved to content”; the last substantive change was 2026-09-12 (`7b6ab60`) |
| L6 | “[待验证] Phase 0 needs measurement to confirm” | 🗑 | No `[待验证]` marker remains in the text; the legend stays |
| L17 | Free engines: “Chrome built-in first, `google-web` as the fallback” | ✅ | `providers/index.ts:29` `FREE_ENGINES = [chrome-builtin, google-web]` |
| L17 | “The originally planned gtx is replaced by it” | ✅ | No `google-gtx` file |
| L20 | Image translation: bitmaps go to Vision OCR over Native Messaging | ✅ | `helper/`, `background/ocr.ts`, `core/image/` |
| L22 | Non-goal: “a degraded path for image translation on non-Mac platforms” deferred | ✅ | No multimodal image-reading implementation (RESEARCH §6.10 records it as #91, to do) |
| L32 | Three paths tags / markers / runs; `wireFormats` is a preference-ordered set | ✅ | `providers/types.ts:66`, `wire-formats.ts:9`, `cache/key.ts` `RenderPath` |
| L45 | The mode is controlled by `html[data-axt-mode]` | ✅ | `data-axt-mode` at 48 sites |
| L58 | Architecture diagram: `[cache?]` on the content side | ❌ | Contradicts L81 in the same section (“cache and requests both in the background, content never touches IndexedDB”) and §8.0; the diagram was not updated with the 09-06 move |
| L73 | popup: “engine choice, progress”; options: “providers, styles, glossary, cache management” | ⚠️ | Broadly right; but UI.md §4 rules “No counts anywhere”, and the popup has no progress numbers; the four options sections are “翻译服务 · 阅读 · 提示词与术语 · 数据” |
| L89–97 §4.0b | Five entries: popup / the `axt-toggle` command (Alt+T) / the context menu with `documentUrlPatterns` / `#axt-translate` / the abstract-page link taking arXiv's href | ✅ | `wxt.config.ts:43`, `background/context-menu.ts:11-15,100`, `content/index.ts:465`, `core/abstract/link.ts:12,30` |
| L101–108 §4.1 | `Block { id, kind: 'text'\|'table', el, unit, cells? }` | ✅ | `extractor/index.ts` splits it into the `TextBlock` / `TableBlock` interfaces with equivalent fields; `cells: Cell[]` carries `numeric` |
| L111 | `extract` is read-only; only `#axt-debug` marks | ✅ | `content/index.ts:464` |
| L112 | `.ltx_note` is the first protect-but-descend case | ✅ | `latexml.ts:138` `descend: true` |
| L119 | “Corrected against 10 fixtures” | ⚠️ | Now 12 real + 1 synthetic; later passages (L158 etc.) already say 12; this sentence was not updated |
| L119 | The rules are concentrated in `src/core/rules/latexml.ts` | ✅ | `RULES_VERSION = '0.10.1'` |
| L121 | The translation root `article.ltx_document` | ✅ | `DOCUMENT_ROOT` L17 |
| L127–137 §5.1 table | The selectors of each translation unit | ✅ | `UNIT_RULES` L31–57 correspond one by one; the code also has `bibitem: .ltx_bibitem:not(:has(.ltx_bibblock))` (the table mentions the “fallback” at L132) |
| L143 | `math, .ltx_Math` listed as a skip rule | ⚠️ | Actually in `PROTECT_RULES` (L133); §5.6 L224 itself says “`math` appears only in PROTECT” — the §5.2 table mixes protect and skip |
| L145 | `.ltx_tag` skipped | ⚠️ | Same, in PROTECT (L136), and named tags take part in translation |
| L147 | `.ltx_text.ltx_font_typewriter` skipped | ⚠️ | In PROTECT (`tt`, L137) |
| L150 and L153 | `.ltx_ERROR` listed twice | ⚠️ | A redundant row |
| L152 | `svg, .ltx_picture` “TikZ figures, measured to hold no translatable text, see §15.1” | ❌ | The code comment now says “the labels inside are overlaid by the image pipeline (§15.6)” (`latexml.ts:95`); §15.6 L1003 records 199 real labels with words. The table row was not synchronised |
| L156–162 | Author names translated, `RULES_VERSION` bumped to 0.7.0 | ✅ (historical) | Now 0.10.1 |
| L164–170 | `.ltx_contact_name` as a void, 0.7.1 | ✅ | `latexml.ts:144` |
| L170 | “1400-odd unit tests run the whole extraction chain in happy-dom” | ⚠️ | This run's `pnpm test` result is in §7 (a background task) |
| L172 | `.ltx_nodisplay` as a void, `RULES_VERSION` → 0.10.1 | ✅ | `latexml.ts:11,152` |
| L175 | `.ltx_tag_item` enters `NAMED_TAGS` | ✅ | L127 |
| L176 | `isBibAuthorBlock` deleted | ✅ | No such symbol in `src/` |
| L177 | Tags with an environment name take part in translation; `ROMAN_ID`; bumped to 0.6.2 | ✅ | `NAMED_TAGS` L115–129, `isNamedTag` L227 |
| L181 | `TABLE_RULES = { root: '.ltx_tabular', cell: '.ltx_td' }` | ✅ | L60 |
| L187 | Partial failure: the original table stays `translated` and gains `data-axt-partial` | ✅ | `renderer/index.ts:48,151` |
| L189–191 | The three numeric-cell regexes | ✅ | `isNumericCell` L436: `NUMERIC_CELL` / `SYMBOL_CELL` / `NA_CELL` (the regex bodies not compared character for character, ⚠️) |
| L196 | References “translated by default, **can be turned off in settings**” | ❌ | `config/schema.ts` has no references switch at all; none in the four options sections either |
| L197–198 | Translated by `.ltx_bibblock`; `isBibAuthorBlock` / `bib-authors` deleted | ✅ | `UNIT_RULES` L42 |
| L208 | The year `.ltx_bib_year` “**wrapped in its own paired placeholder**” | ❌ | `latexml.ts:153-158`: `bib-year` became a void in `PROTECT_RULES` (reason: the content of a paired placeholder still gets rewritten, Codex #74); the void list of §6.1 does not register it either |
| L215–218 §5.5 | `RULES_VERSION` enters the cache key; a version fork goes through `latexml-v1.ts` | ✅ / ⚠️ | In the key ✅ (`cache/key.ts:6`); the fork was never needed |
| L224–227 §5.6 | Exports `UNIT_RULES` `TABLE_RULES` `SKIP_RULES` `PROTECT_RULES`, `documentRoot` `classify` `isNumericCell`; priority skip > table > unit > protect | ✅ | `latexml.ts` L31/60/85/132/237/372/436; `classify` L237–247 in that order |
| L233 | The protector is an original implementation | ✅ | `src/core/protector/*` carry no attribution header |
| L239 §6.1 void list | `math` `.ltx_ref` `.ltx_cite` `.ltx_tag` `code` `.ltx_font_typewriter` `.ltx_note` `.ltx_note_mark` `.ltx_note_type` `.ltx_contact_name` `.ltx_nodisplay` inline images `svg` `br` | ⚠️ | `PROTECT_RULES` also has `.ltx_bib_year`, `.ltx_indexrefs`, `img`; `code` / `svg` go through the SKIP rule “equivalent to a void inside a unit”. The list is incomplete but points the right way |
| L246–252 §6.2 | `ProtectedBlock { blockId, format, text, slots, paired }` | ⚠️ | `serialize.ts:11-19` has `format text slots paired voidCount`, **no `blockId`** (the id lives on the pipeline's segment) |
| L255 | `markers` ids encoded as bijective base-26 letters | ✅ | `tokens.ts:24-38` |
| L257 | Leading labels restored (issue #150) | ✅ | `protector/label.ts` `restoreLeadingLabel`, `LABEL_FORMATTING` |
| L258 | `escapeText` / `unescapeText` plain-text round trip | ✅ | `protector/text.ts` (export names not checked one by one, ⚠️) |
| L263 | Over the void threshold 40 → a batch of its own | ✅ | `VOID_DENSE_THRESHOLD = 40` (`serialize.ts:38`), `pipeline/batches.ts:90` |
| L272 §6.3 | Validation failure: retry the single block once → runs → mark failed | ✅ | `pipeline/run.ts:212-231` |
| L274 | `pnpm e2e:placeholders` exists | ✅ | `package.json`, `tests/e2e/placeholders.mjs` |
| L278–280 §6.4 | Clones stripped of `id`; `stripInjected` removes `on*` and `javascript:` / `data:text/html` | ✅ | `core/marks.ts:36,72` |
| L285 §6.5 | `FUNCTIONAL_INLINE = a[href]` | ✅ | `latexml.ts:254` |
| L287 | “The three free engines of v1” | ⚠️ | There are three now (chrome-builtin / google-web / microsoft), but microsoft keeps markers only and is not of the “all preserve placeholders” kind |

<!-- section 2.1 done -->

### 2.2 DESIGN.md §7 (three-mode rendering)

| Location | Claim | Status | Evidence |
|---|---|---|---|
| L301 | The translation node = the next sibling, same tag name, class plus `axt-t`, `data-axt-for` | ✅ | `renderer/index.ts` `renderText`; `tests/renderer/restore.test.ts` |
| L302 | The original node only gains `data-axt-id` / `data-axt-state` / `data-axt-inline` | ⚠️ | It also gains `data-axt-partial` (L187 admits it), `data-axt-note="moved"` (L325), `data-axt-identity` (L432), `data-axt-split`, `data-axt-fit` — the attribute set on original nodes has long outgrown these three; the spirit of the invariant (only `data-axt-*` added) still holds |
| L303 | Global state only on `<html>`: `data-axt-on / mode / lang / dir` | ⚠️ | Also `data-axt-underline`, `data-axt-blur`, `data-axt-img-modes` (recorded in §7.5 / §15 separately) |
| L304 | Translations get `dir`; `RTL_LANGUAGES` / `RTL_PRIMARY` / `RTL_SCRIPTS` | ✅ | `config/languages.ts:991-1018`, `renderer/index.ts:198-202` |
| L305 | Table `lang` / `dir` go on the cells whose content was replaced | ✅ | `renderer/index.ts:263-264` |
| L307 | Restore = delete `.axt-t` and `.axt-img`, delete `data-axt-*`, remove the injected `<style>` | ✅ | `restore()` + `marks.ts` (also removes the `HL_CLASS` / `PEEK_CLASS` layers, recorded in §7.7) |
| L311–320 §7.2 | Two subgrid columns, `:has(+ .axt-t)` pairing, taking over the ar5iv grid | ✅ | `styles/modes.css` (selectors not compared one by one, ⚠️) |
| L321 | Multi-panel flex figures not taken over, `MULTI_PANEL_FLEX` | ✅ | `side-layout.ts:20`, `latexml.ts:333` |
| L325 | `localizeNotes`, `data-axt-note="moved"`, `.axt-note-t` | ✅ | `renderer/notes.ts` |
| L329 | `renderer/margin-notes.ts` stacks by hand, `clearMarginNotes` | ✅ | Exists |
| L332 | `isSideContainer()` uses `closest(SIDE_DENY_SUBTREE)` | ✅ | `side-layout.ts:38,53` |
| L333 | `MARGIN_ASIDE` in `rules/latexml.ts` | ✅ | L316 |
| L335 | The `.ltx_inline-block:not(.ltx_transformed_outer)` exemption | ✅ | `latexml.ts:343,349` |
| L336 | `fitTables` measures both tables and takes the max | ⚠️ | `table-fit.ts` exists; details not read |
| L338 | `splitFigures`, `REAL_TRANSLATION` excludes mirror / split | ✅ | `split-figures.ts:33` |
| L346 | `FIT_TARGETS` includes `table.ltx_eqn_table` | ✅ | `latexml.ts:63-67` |
| L362–366 | `fitTables` read-only measurement, `resetFitCache`, `FitDeps.columnWidth` | ✅ | Exported by `table-fit.ts` |
| L368–385 | Incremental prep, `createCoalescer<T>`, `RunOptions.onRendered`, `readPairMargins` / `writePairMargins` | ✅ | `scheduler/coalesce.ts:29`, `pair-margins.ts` |
| L398–407 | The width contract `--axt-side-w` / `--axt-article-w` / `--axt-margin-w`, `--axt-gap` in rem | ✅ | The `modes.css` variables occur 15 / 7 / 3 / 7 times |
| L408 | `matchMedia('(max-width: 1279px)')`, `createModeController` | ✅ | `responsive.ts:6,35` |
| L410–412 | `SIDE_LAYOUT` belongs to the rules module; `selector-boundary.test.ts` scans `src/` | ✅ | `latexml.ts:331`, the test file exists |
| L416 §7.3 | “stack, the **default layout**” | ❌ | `DEFAULT_CONFIG.mode = 'side'` (`config/schema.ts:110`, the owner's decision of 2026-09-11, UI.md S-P-70); neither §7.3 nor §9 L747 “`mode: 'stack' \| 'side' \| 'only'`” updated the default |
| L418 | Short headings ≤ 60 characters share the line, `data-axt-inline` | ✅ | `latexml.ts:368` `isInlineTitleCandidate`, the attribute at 8 sites |
| L422–426 | Block marks written in one go, not sliced; state attributes still sliced | ✅ | `pipeline/run.ts:144` (“writing synchronously also settled the halted() race”) |
| L428–436 | `observerThresholds` 5% grid, clamped to the reachable maximum | ✅ | `scheduler/lazy.ts:33-39,102-106` |
| L432 | A translation equal to the original gets `data-axt-identity` | ✅ | The attribute at 3 sites |
| L440 §7.4 | only mode hides `[data-axt-state="translated"]` | ✅ | `modes.css` (not checked line by line, ⚠️) |
| L445–449 | The three listeners of `renderer/anchors.ts` | ✅ | `installAnchorFallback` |
| L455–475 §7.4b | Translations marked `lang`; mirrors and skeletons `aria-hidden` + `inert`; `tests/e2e/a11y.mjs` | ✅ | `mirror.ts:68`, `skeleton.ts:62`, the e2e file |
| L464 | “This project's floor of 131” | ✅ | `wxt.config.ts:31` `minimum_chrome_version: '131'` |
| L479–481 §7.5 | The v12 appearance: `data-axt-underline` / `data-axt-blur` + five variables; `appearanceRule()`; `presets.css` cut to three rules; `data-axt-style` and `--axt-accent` retired | ✅ | `style-preset.ts` `appearanceRule`, `presets.css` (three groups: underline / blur / default variables); `data-axt-style` survives only in 3 **comments** (`renderer/index.ts:53,76`, `content/index.ts:87`) — the comments are stale |
| L483–488 | “The original record (the preset scheme of 2026-09-05)”: 20 presets, `glow` / `gradient` made static | 🗑 | Explicitly marked historical, yet still half of §7.5; and disciplines such as L487 “the shared rule **lists only the underline-class ids**” have been replaced by v12's `html[data-axt-underline]` form |
| L489–493 | “Decoration parameters adjustable … written into config (v9)”; “implemented without changing `modes.css` and `presets.css`: `styleVarsRule()` … overrides the `--axt-color` that `muted` / `green` write and the `--axt-accent` on `html[data-axt-on]`”; “when `style` changes call `applyStyle()` — recompute only the injected sheet's content and `data-axt-style`” | ❌ | After v12 `config.style` does not exist (`schema.ts` has `appearance`), `styleVarsRule` does not exist (only `appearanceRule`), `data-axt-style` is no longer written, `presets.css` was rewritten. The passage is not marked “historical” and reads like the current design |
| L494 | The preset selector `.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)` | ✅ | The shared rule of `presets.css` |
| L495 | Advanced CSS accepts a declaration block only | ✅ | UI.md S-O-47; `style-values.ts` `sanitizeColor` (the declaration-block validation not checked, ⚠️) |
| L499–508 §7.6 | The skeleton `.axt-skel` / `.axt-skel-line`, `--axt-skel`, cap 60, Web Animations, `prefers-reduced-motion` | ✅ | `skeleton.ts:7-8,14,33,74`, `modes.css:14-47` |
| L508 | The failed state: the `.axt-t.axt-error` Shadow DOM widget; `axt:retry-failed` | ✅ | `renderer/failed.ts`, the message at 3 sites |
| L529 | “`minimum_chrome_version` is 131” | ✅ | Contradicts L920 (see §3) |
| L531 | Sentence boundaries “reported only by Microsoft at present” | ⚠️ | L555 in the same section says “Microsoft, and Google after #137”; `providers/sentence-markers.ts` exists (the marker scheme of §8.6) — L531 was not updated with #137 |
| L532 | Registered into the `WeakMap` of `renderer/sentences.ts` | ✅ | The file exists, `mirrorPair` exported |
| L539 | “The colour follows `--axt-green` … `styleVarsRule` rewrites it from `config.style.accent` — one colour control”; “the switch `config.reading.sentenceHighlight`” | ❌ / ✅ | `--axt-green` is still the default ground (`presets.css:26`, `highlight.css:39`), but what rewrites it is v12's background highlight configuration `--axt-hl-color` / `--axt-hl-mix`; `styleVarsRule` / `config.style.accent` no longer exist; the switch ✅ (`schema.ts:83`) |
| L542–555 | The only-mode source hover `axt-peek`, dwell 600 ms, grace 120 ms, `inert` | ✅ | `peek.ts:30` `PEEK_DWELL_MS = 600`, `highlight.ts:41,62`, `marks.ts` `PEEK_CLASS` |

### 2.3 DESIGN.md §8–§10 (providers, cache and configuration, scheduling)

| Location | Claim | Status | Evidence |
|---|---|---|---|
| L565 | content sends only three messages `axt:translate` / `axt:cancel-scope` / `axt:provider-status` | ❌ | content also sends `axt:ocr`, `axt:helper-status`, the `axt:page-status` reply, `axt:stats`, `axt:ping` etc. (`shared/messages.ts` has 17 kinds in all); “only these three for translation” barely holds |
| L569–571 | The reasons for moving back to the background, and RESEARCH §6.7 / §6.8 | ✅ | Agrees with RESEARCH |
| L576 | “The bundle dropped from 428.95 kB to 152.47 kB” | ⚠️ | Historical numbers; content has since gained images / SVG / highlight / peek, not re-measured |
| L578–585 | `pnpm e2e:local-endpoint` | ✅ | The script exists |
| L589–594 | `TranslationTransport { translate, cancel, status }` | ⚠️ | `providers/transport.ts` exists; the interface members not checked one by one |
| L597–598 | `createLocalTransport` / `createMessageTransport` (`shared/transport.ts`) | ✅ | The file exists |
| L600 | A named engine `TranslateCall.providerId` skips the fallback chain | ⚠️ | Implementation not read |
| L604 | `id: 'openai-compat' \| 'anthropic' \| 'gemini' \| 'chrome-builtin' \| 'google-web'` | ❌ | `types.ts:58` is `id: string`; the real values include `microsoft` and the reader's service ids (§8.5 L721), `anthropic` / `gemini` do not exist |
| L606–612 | `kind` / `wireFormats` / `maxBatchChars` / `maxBatchItems` / `rateLimit` / `isAvailable` / `translate` | ✅ | `types.ts:55-80`; also `maxConcurrent` (L77, mentioned in §8.3), `promptKey` (L88), `cacheId` (L95), absent from the interface example |
| L615–624 | `TranslateRequest { segments, source: 'en', target, context: { paperTitle, sectionTitle, glossary } }` | ⚠️ | The code's `TranslateContext` also has `abstract` (L23); `TranslatedSegment` carries `alignment` (the product of §8.6, and DESIGN has no §8.6 anywhere — see §7, to verify) |
| L637 | `openai-compat` “covers OpenRouter (the default endpoint) … the default model is a cheap fast tier” | ❌ | Since v12 there is no default endpoint or model: `services: []`, `DEFAULT_CONFIG.provider = 'microsoft'`; “no vendor templates” (L721); the `openrouter.ai` in `host_permissions` is a leftover |
| L638–639 | The `anthropic` / `gemini` rows | 🗑 | L646 already says not implemented for now, “kept in the table as an illustration of the interface shape” |
| L640 | `chrome-builtin` `['tags']`, Chrome 138+ | ✅ | `wire-formats.ts`; the relation of 138 to the manifest's 131, see §3 |
| L641 | `google-web` `['tags','markers']` | ✅ | `wire-formats.ts` |
| L642 | `microsoft` `['markers']` | ✅ | Same |
| L648 | `microsoft` not in `FREE_ENGINES` | ✅ | `providers/index.ts:29-34` |
| L648 end | “The negotiation of §8.5 is order-dependent; before #103 it has to become ‘the primary decides the format’” | ❌ | §8.5 L727–732 already records the change to order-independence on 2026-09-09, and the `providers/index.ts` comment agrees; this sentence predates the change and was not deleted |
| L650 | Free engines reuse `isAvailable()` for language support | ✅ | The support table of `microsoft.ts` |
| L652 | “The Microsoft edge channel is connected” | ✅ | — |
| L656 | AI SDK 7 `generateText` + `Output.object`, `maxRetries: 0` | ⚠️ | `openai-compat.ts` not read; `ai@^7.0.91` in the dependencies |
| L657 | Two-layer prompts: `prompt-library.ts` `default` / `precision-rewrite`; `prompt.ts` `PROTOCOL_BLOCK` | ✅ | `prompt-library.ts:13-14`, `prompt.ts:18` |
| L659 | `<document_metadata>` delimiting | ✅ | `prompt-library.ts:21-28` |
| L660 | Glossary caps 200 / 120 / 200 / 6000, `GLOSSARY_LIMITS`, `normalizeGlossary`, `PROMPT_VERSION` bumped to 4 | ✅ | `schema.ts:16,26`, `prompt.ts:15` |
| L661 | Paper-level context cut to 1200 characters | ⚠️ | No literal 1200 seen in `pipeline/paper.ts` (possibly renamed or made a constant) |
| L662 | The cache key holds `promptKey` and the context | ✅ | `cache/key.ts:1,40` |
| L667 | `CHAIN_CONFIG_FIELDS` = `provider / openaiCompat / prompts / targetLanguage / fallback` | ❌ | Now `['provider','services','prompts','targetLanguage','fallback']` (`transport.ts:179`); `openaiCompat` became `services` in v12 |
| L668 | A failed response carries `partial` | ✅ | `run.ts:242` |
| L669–671 | `createGlossaryMatcher` matches per segment | ✅ | `providers/glossary.ts` |
| L672 | Batches of 1000 characters / 4 segments; rate 8/s burst 20; 100 ms of batching | ✅ | `openai-compat.ts:57-58`, `translate-service.ts:109,135` |
| L675 | `ProviderError.isolatable` defaults by kind | ✅ | `types.ts:134-143` |
| L678 | Timeout 20 s + 15 ms/character, capped at 120 s | ✅ | `translate-service.ts:137` |
| L682 | `google-web` `maxConcurrent: 2`, `rate: 20 / capacity: 8` | ✅ | `google-web.ts:85-86` |
| L696–697 | `isolatable`, HTTP status mapping 429 / 401 / 403 / 4xx→`bad-request` | ✅ | `http-errors.ts:13-17` |
| L699 | The default fallback chain `chrome-builtin` → `google-web` | ✅ | `FREE_ENGINES` |
| L700 | `google-web` “rate pressed down to 2 requests/s, burst 2 … **no batching** (only the LLM batches)” | ❌ | Contradicts L682 / L665; the code has `rate 20 / capacity 8 / maxConcurrent 2`, and every provider gets a `BatchQueue` (`translate-service.ts:183-186`) |
| L701 | 429 pauses the whole queue | ✅ | `request-queue.ts` (ported as it was) |
| L702 | Thinking mode sends fields by endpoint domain | ✅ | `thinking.ts:15-18` |
| L703 | “**Instant engine**: when `chrome-builtin` is ready, render the blocks in the viewport first and replace them in place when the LLM translation arrives … the user can turn it off in settings” | ❌ | No such implementation: the chain only falls back on failure (`fallback.ts`), there is no “built-in first, then LLM replaces” double write; no matching switch in the configuration. RESEARCH §7 item 21's suggestion was written in as a settled design |
| L707–713 §8.4 | `isAvailable()` accepts only `available`; `BUILTIN_MAX_ITEMS = 20`; session creation times out at 60 s; sessions cached per language pair | ✅ | `chrome-builtin.ts:29,37,102` |
| L710 | “content calls `FallbackService.reset()` to withdraw the demotion record” | ❌ | `fallback.ts:38` “no `reset()`”; §8.5 L734 says so too; `axt:engine-ready` rebuilds the whole chain instead |
| L710 | “The download entry therefore lives only in the popup's click handler” | ⚠️ | The Chrome card on the settings page has “下载” too (`options/sections/Services.tsx:31`, UI.md S-O-11); both are user gestures, the conclusion stands |
| L713 | `Translator` exposed in the isolated world, measured | ✅ | RESEARCH §6.3 |
| L721 §8.5 | `config.services[]`, `getProvider` builds an OpenAI-compatible engine by service id | ✅ | `providers/index.ts:11-13`, `services.ts` |
| L722 | `buildChain` filters twice | ✅ | `providers/index.ts:59` |
| L723 | `axt:translate-page { restart }`, `onProvider` | ✅ | `messages.ts:43`, `run.ts:56` |
| L724 | `providers/fallback.ts` about 110 lines | ⚠️ | Not counted |
| L725 | Cooldown 60 s; `no-key` / `auth` permanent | ✅ | `fallback.ts:55,61` |
| L734 | `FallbackService` has no `reset()` | ✅ | `fallback.ts:38` |
| L735 | Configuration v5 `fallback.enabled` on by default | ✅ | `schema.ts:72` |
| L739 §9 | Dexie, ported from FluentRead | ✅ | `cache/store.ts` |
| L740 | The key `sha256(providerId \| model \| PROMPT_VERSION \| RULES_VERSION \| target \| renderPath \| normalizedText)`; “`CACHE_KEY_VERSION` bumped to 3, to 4 at the rename” | ❌ | The real key also holds `promptKey`, `context` (L662 in the same section says so); `CACHE_KEY_VERSION = 6` (`key.ts:70`), the bumps to 5 and 6 are not recorded |
| L740 | `providerId` takes `cacheId ?? id`, `openai-compat:<origin><path>` | ⚠️ | `types.ts:95` `cacheId` exists; after v12 the service id is itself the provider id, whether the `openai-compat:` prefix is still used not checked |
| L741 | TTL 30 days / 20,000 entries / 50 MB / 256 KB / hot layer 256 | ✅ | `store.ts:42-46` |
| L742 | `axt:cache-stats` / `axt:cache-clear`, `cleanup()` before the statistics | ✅ | Each message at 3 sites |
| L743 | The `byteSize` index, Dexie v2 | ✅ | `store.ts:58` |
| L744 | `CACHE_READ_BUDGET_MS` 2 s | ✅ | `translate-service.ts:116` |
| L745 | No cache write after a cancel, `cancelledScopes` | ✅ | `translate-service.ts:226` |
| L746 | `expectationsFromText`, `cache.bypass` | ✅ | `translate-service.ts:15,58` |
| L747 | Configuration versions v1…v12 | ❌ | `CONFIG_VERSION = 13` (v13 adds `uiLanguage`, recorded in UI.md §6, not in DESIGN); the purpose of v10 (a bump against downgrades after Microsoft was connected) is not recorded either; “the v1 shape `provider: 'openai-compat' \| …`” is history |
| L749 | `configFallbackReason()`, a red warning at the top of the popup | ⚠️ | The function ✅ (`storage.ts:115`); UI.md L114 says the popup's S-P-34 was removed and it moved to the top of the settings page (S-O-02) — DESIGN not updated |
| L753 §10 | `scheduler/lazy.ts`, `renderer/pending.ts`, `scheduler/title.ts`, `pipeline/run.ts` | ✅ | All exist |
| L757 | `rootMargin` 1000 / `threshold` 0; the settings page's “pre-translation distance (0–10000px, step 100) and visibility threshold (0–1)” | ⚠️ | The defaults ✅ (`lazy.ts:56`); the settings UI became steps (半屏 / 一屏 / 两屏 / 三屏; 刚露出 / 露出一半 / 完全露出, `Reading.tsx:98-109`, UI.md S-O-50/51), no longer number boxes |
| L761 | “The pending node (§7.6) … a ring” | ⚠️ | This section still says “ring” in several places (L762, L783 does not); §7.6 changed to the skeleton |
| L768 | No scroll anchoring | ✅ | No `elementFromPoint` anchoring code (not grepped, ⚠️) |
| L769 | `createCoalescer(fn, { delay: 150, maxWait: 1000 })` gathers the dirty set | ✅ | `coalesce.ts` |
| L771 | `maxConcurrent` 8, `maxTotalMs` 180 s, the defaults in `translate-service` | ✅ | `translate-service.ts:125-126` |
| L783 | “`batch-queue` (… **only the LLM batches**)” | ❌ | Contradicts L665; every provider batches |
| L783 | `p-queue` and the hand-written pause deleted | ✅ | No `p-queue` in `package.json` |

<!-- section 2.2-2.3 done -->

### 2.4 DESIGN.md §11–§15 (tests, phase plan, borrowing boundary, risks, image translation)

| Location | Claim | Status | Evidence |
|---|---|---|---|
| L793 | The counter-example test files `pipeline/run.test.ts`, `protector/runs.test.ts`, `protector/rehydrate.test.ts` (A03), `core/marks.test.ts`, `protector/clone.test.ts` | ✅ | All exist; `rehydrate.test.ts:41` “[known behaviour, pending A03]” |
| L794 | `pnpm e2e:placeholders` | ✅ | — |
| L798 | `tests/e2e/extension.mjs`, `local-endpoint.mjs`, `layout.mjs` | ✅ | Exist; `image.mjs` and `options-page.mjs` are not registered in this table |
| L799 | `tests/e2e/a11y.mjs` | ✅ | — |
| L802 | “10 fixtures” | ❌ | 12 + `synthetic-structures.html` |
| L170 (§5.2) | “1400-odd unit tests” | ⚠️ | This run: 109 files, **1518** tests passed (28 s) |
| L808–813 §12 Phase 0 | “completed”; but L812 is still `[ ]` “the isolated world to be verified when `chrome-builtin` is connected” | ❌ | RESEARCH §6.3 measured it on 2026-09-05, and §8.4 L713 says so; the checkbox was never ticked |
| L815–818 Phase 1 | The `feat/scaffold` / `feat/rules` / `feat/extractor` branch plan | 🗑 | A completed plan with no tick state; “`pnpm fixtures:stats` switches to PROTECT_RULES” is done |
| L820–826 Phase 2 | “`openai-compat` (… + `generateObject`)” | 🗑 | §8.2 L656 already says `generateObject` was replaced by `Output.object`; `p-queue` is deleted too |
| L828–829 Phase 3 | “Provider requests move to content (§8.0)” | ❌ | §8.0 reversed it to the background; the line was not changed |
| L829 | “side / only modes and the width logic; `chrome-builtin` + `google-web` with the runs path; the fallback chain; scheduling and progress; style presets; the glossary; the options page” | ⚠️ | All implemented, but the list has no completion marks; a reader cannot tell “plan” from “status” |
| L831–841 | PR 1 / 2a / 2b and the porting trade-offs | ✅ (historical) | Agrees with THIRD_PARTY |
| L843–847 Phase 4 / v2 | “More fixtures and rule corrections; performance; cache export / import; release” | ⚠️ | No progress recorded; cache import / export is not implemented |
| L855–859 §13 table | The five reference projects | ✅ | Agrees with the THIRD_PARTY project table |
| L861 | “arXiv adaptation … Phase 1 completed” | ✅ | — |
| L863 | The GPL header template `// 移植自 reference/<repo>/<path>@<commit>（GPL-3.0），<YYYY-MM-DD> 移植、有修改` | ✅ (code) / ❌ (contradicts CLAUDE.md) | All 26 files use this format; CLAUDE.md L81 changed to the English template |
| L863 | “The project is open source under GPL-3.0” | ❌ | The repository root has **no LICENSE file** (`ls LICENSE*` finds nothing), and `package.json` has no `license` field either; #167 to do |
| L873 | The LaTeXML version risk: “a probe function forks” | ⚠️ | No probe function implemented (never needed) |
| L877 | Narrow screens fall back of themselves through `matchMedia` | ✅ | `responsive.ts` |
| L884 | “With the helper undetected only bitmaps are not translated, SVG proceeds as usual — **the settings section is no longer greyed out whole**” | ✅ | The comment at `schema.ts:88` agrees |
| L884 | “No entry for a single image” | ✅ | No matching UI |
| L891 | Inline `svg.ltx_picture` “measured to have no `<text>`; text appears only as `foreignObject` and rarely, skipped” | ❌ | §15.6 L1003: 199 `foreignObject`s with words, connected to the image pipeline; this sentence of §15.1 did not follow §15.6 |
| L894 | “The overlay is ported from the DOM rendering part of `getImage.js` in `xulihang/ImageTrans_chrome_extension` (GPL-3.0) (`fitBoxFontSize`, `detectBackgroundColor`, line wrapping, rounded boxes)” | ⚠️ | The file headers of `renderer/image.ts` / `image/boxes.ts` carry **no** ImageTrans attribution line, and THIRD_PARTY has no matching file row (only the snapshot in the project table); §15.2 L911 in turn says “ImageTrans's JS bisection of the font size … not used”. Either it is really a rewrite (fix the document) or the registration is missing (a GPL §5 problem) |
| L909 | OCR results cached by `imageHash \| helper version` in the same Dexie database | ⚠️ | `background/ocr.ts` exists, the key shape not checked |
| L910 | `.axt-img` does not carry `.axt-t`; `marks.ts` recognises it | ✅ | `data-axt-img-modes` at 7 sites, `marks.ts` |
| L911 | CSS anchor positioning needs Chrome ≥131 | ✅ | `wxt.config.ts:31` |
| L920 | “`wxt.config.ts` **declares no minimum Chrome version**, and installed on an old Chromium it must not break the page” | ❌ | `wxt.config.ts:31` `minimum_chrome_version: '131'` (the comment says it was added after Codex pointed it out on #99); contradicts §7.7 L529 and §7.4b L464 |
| L929–942 §15.3 | The protocol `v`, `ping`→`version`, `frames`, `truncated`, `unsupported-protocol` | ✅ | `helper/main.swift:11,18,31,76,102,149-153` |
| L946 | The helper “Swift, ~100–200 lines” | ✅ | 167 lines |
| L947 | The host manifest in `<user data directory>/NativeMessagingHosts/` | ✅ (measured record) | The e2e `.profile-image/NativeMessagingHosts` exists |
| L948 | “Undetected → **the settings item greys out**, image translation silently does not run” | ❌ | Contradicts L884 “no longer greyed out whole”; UI.md S-P-86 / S-O-27 are “show the install guide” |
| L949 | `nativeMessaging` a required permission for now | ✅ | `wxt.config.ts:40` `permissions: ['storage','nativeMessaging','contextMenus']` |
| L952–959 | The install guide completes inside the popup; `src/ui/HelperSetup.tsx`; `axt:helper-await` every 2 s, capped at 3 minutes; session storage | ✅ | The file and the message exist; `background/helper-await.ts` |
| L960 | “Later: an `apple-translate` provider” | ⚠️ | Not done, pure conjecture |
| L980–989 §15.5 | `src/core/svg/glyphs.ts` produces `OcrLine[]`; the matrix decomposed with `atan2(b,a)`; glyphs with a `transform` ancestor skipped; `len` / `thick` boxes; `src/core/svg/runs.ts` recognises code | ✅ | `glyphs.ts:73-85`, `renderer/image.ts:38-39,109-118`, `svg/runs.ts` |
| L986 | “v1 draws only multiples of 90° … **now** every run is drawn” | ✅ | `glyphs.ts` has no `quarterTurn` any more (the forward reference in RESEARCH §6.11 L628 is stale) |
| L993–1010 §15.6 | `foreignObject` labels go through the image pipeline; `proseText`; adjacent lines not merged; deduplication; `pictureTexts` reads no geometry | ✅ | `svg/foreign.ts`, `latexml.ts:401 proseText`, `FIGURE_SELECTORS.pictureText` |
| L1011 | “15.5b reference” placed after 15.6 | ⚠️ | Numbering out of order |
| Whole text | **The code cites a §8.6 that does not exist in DESIGN** (sentence alignment / sentence markers, issue #105): `cache/key.ts:49,65`, `providers/types.ts:11,82`, `translate-service.ts` at 7 sites, `pipeline/sentences.ts`, `pipeline/run.ts:172`, `microsoft.ts:175`, `rules/latexml.ts:283`, two test files | ❌ | DESIGN's §8 has only 8.0–8.5 (see the heading list); §7.7 L531 also writes “§8.6 / `providers/alignment.ts`”. This whole piece of design (boundaries reported by the engine or markers inserted by the service layer, the reason for `CACHE_KEY_VERSION` 5→6, the `alignment` field) **exists only in code comments** |

### 2.5 RESEARCH.md

| Location | Claim | Status | Evidence |
|---|---|---|---|
| L3 | “Matches DESIGN.md v0.1 · Phase 0 tasks 1–7 all completed” | ⚠️ | The header was never updated; the content runs on to 2026-09-09 |
| L7 | “Phase 0 has no test or build target yet; `pnpm test` / `pnpm build` take effect from Phase 1” | 🗑 | In effect long ago |
| L13 | “10 papers” | ⚠️ | L42 added 2; 12 in all |
| L25 | `RULES_VERSION 0.1.0-phase0` | ✅ (historical) | Now 0.10.1 |
| L101 §2.9 | “SVG figures hold no translatable DOM text in practice; v1 skips `svg` whole; the OCR route of §15 is meaningful for `img` only” | ❌ | DESIGN §15.5 (external SVG goes through glyph reading), §15.6 (199 labels with words in the `foreignObject`s of inline TikZ, 2026-09-11); the comment at `latexml.ts:95` was changed. §6.11 L473–476 still says “§2.9 still holds for inline SVG” — also overturned by §15.6 |
| L160 §3.2 | “side mode only needs `--main-width` overridden on `html[data-axt-mode="side"]`” | ❌ | DESIGN §7.2 L407 measured “overriding `--main-width` alone without touching the tracks overflows horizontally” and switched to rewriting the body grid with three tokens |
| L162 | “The 1100px auto-fallback threshold of §7.2 … suggested 1280px instead” | ✅ (adopted) | `responsive.ts:6` `(max-width: 1279px)` |
| L200–212 §4 map | The “`google-gtx` / `translateHtml`” row | ⚠️ | gtx not connected; the map itself is still useful |
| L280 | “gtx conditionally declares `preservesMarkup: true` … translateHtml is not worth a provider of its own” | ❌ | Reversed in the same file at §6.6 and §7 line 23: translateHtml adopted, gtx not connected; the `preservesMarkup` field no longer exists |
| L344 §6.5 | “Read Frog puts the provider's fetch in the content script” | ❌ (self-corrected) | Corrected at §6.7 L395; the whole of §6.5 carries a strike-through note |
| L392 | “The Ollama listed in CLAUDE.md … formal translation (through content) is bound to fail” | ⚠️ | Historical state; fixed as §7 line 24 says (background); the sentence is not marked “fixed” |
| L413 | “This table does not measure a cold start” **[待验证]** | ⚠️ unclosed | No follow-up measurement |
| L434 | “Covers only the one kind of waiting where a fetch is in flight” **[待验证]** | ⚠️ unclosed | Worker survival during a 429 backoff not measured |
| L436 | “`Translator.create()` in the background did not get tested … re-test when the language pack is ready” | ⚠️ unclosed | — |
| L594–597, L628–630 §6.11 | Forward references to `glyphs.ts`: “skips any glyph with a transformed ancestor”, “`quarterTurn` … where the decision now lives” | ✅ / 🗑 | The former ✅ (`glyphs.ts:92`); `quarterTurn` was replaced by “every run is drawn” on 2026-09-11, the symbol does not exist |
| L616–627 | “Recommendation for v1: place the quarter turns, drop the rest” | 🗑 | Overturned by DESIGN §15.5 L986 |
| L735–767 §7 | The revision list | See §5 of this document | — |

### 2.6 UI.md

| Location | Claim | Status | Evidence |
|---|---|---|---|
| L6 | “Status: draft, under discussion section by section”; §1 / §2 / §3 / §5 marked [议] | ❌ | The copy of §3, the tokens of §5 and the language of §6 are all implemented (`src/ui/strings.ts`, `src/styles/ui.css`, `src/locales/`); the [议] tags and “draft” no longer reflect the state |
| L27 | “All three reference products use ‘翻译服务’” | ⚠️ | Cannot be verified |
| L53 | Typography (#47) “decided, not done” | ✅ | No implementation |
| L68 S-P-01 | The manifest `name` follows “Read arXiv” | ✅ | `wxt.config.ts:21` |
| L93 S-P-50 | The shortcut badge reads `commands.getAll()` | ⚠️ | `popup/data.ts` not read |
| L99 S-P-70 | `MODE_ORDER` side first, side the default | ✅ | `strings.ts:112` `['side','stack','only']`, `schema.ts:110` |
| L107 S-P-83 | “管理译文样式…” opens `options.html#reading` | ⚠️ | No `#reading` literal found by grep in the popup sources (possibly concatenated) |
| L114 | The status pills S-P-12…18 and S-P-34 removed | ✅ | The feature table of §8 L356 still writes “configuration read failure notice … explained inside the popup card S-P-34, P10” — self-contradictory |
| L124 S-O-01 | Four sections `#services / #reading / #prompts / #data` | ✅ | `options/App.tsx:16` `SECTIONS` |
| L126 S-O-05 | Interface language v13 | ✅ | `schema.ts:97` |
| L128 S-O-11 | “下载” on the Chrome card of the settings page | ✅ | `Services.tsx:31` |
| L143–147 S-O-27 | The two-step guide, shared `HelperSetup.tsx`, automatic detection | ✅ | The file and `helper-await` exist |
| L151 S-O-42 | Six built-in styles | ⚠️ | `appearance.ts` has three built-in highlights ✅ (柔和绿 / 淡黄 / 淡蓝); the six styles not checked one by one |
| L159–160 S-O-50/51 | Steps: 半屏…三屏; 刚露出…完全露出 | ✅ | `Reading.tsx:98-109` |
| L181 | The S-E mapping is used for S-O-28 | ❌ | §3.2 has no S-O-28 (the connection result is S-O-20) |
| L183–193 §3.4 | The nine `ProviderErrorKind`s → reader sentences | ✅ | `types.ts:98` nine kinds; `locales/zh-CN.ts:280` |
| L197–220 §4 | P0–P15 | ⚠️ | `popup/fixtures.ts` has 17 `P<n>` references; not checked state by state |
| L247–266 §5 | The tokens `--axt-accent #b31b1b / #d63c3c` etc. | ✅ | `ui.css:18,35,52`; the “[议]” tag is stale |
| L268 | “Whether in-page components follow arXiv's own dark theme: [待验证]” | ⚠️ unclosed | DESIGN §7.7 L546 mentions that arXiv's `data-theme` is switched by the site and the panel colours are read from the page — a partial answer, UI.md not updated |
| L290–327 §6 | The locale pack files, `pickLocale`, `uiLanguage` | ✅ | `src/locales/{zh-CN,en,index}.ts`, `ui/apply-locale.ts`, `public/_locales/` |
| L329–339 §7, items that need DESIGN changed | (1) the default provider becomes `google-web` | ❌ | The code default is `microsoft` (`schema.ts:105`), and UI.md's own S-P-46 says Microsoft is the default; the item is stale |
| Same | (2) The language pack download entry in popup + settings page | ⚠️ | Both implemented; DESIGN §8.4 still says “only in the popup” |
| Same | (3)(4) “测试连接” merged into “连接”, save on change | ⚠️ | Implemented (S-O-19); DESIGN §8.0 L565 and §9 still say “测试连接”, “saved on the settings page” |
| Same | (5) The pre-translation parameters as steps | ⚠️ | Implemented; DESIGN §10 L757 still describes number boxes |
| Same | (6) The in-page “已改用” notice | ⚠️ | §8 L369 “undecided”, §9 item 5 still under discussion |
| Same | (7) The error mapping table next to `providers/types.ts` | ⚠️ | Actually placed in `locales/zh-CN.ts` (following the interface language, more sensible), not written back |
| Same | (8) `nativeMessaging` made optional + S-O-86 | ⚠️ | Not done (at distribution) |
| Same | (9) #47 typography into the schema | ⚠️ | Not done |
| L345–371 §8 feature table | The id column disagrees with §3 across the board: `S-O-41…44` (styles), `S-O-45…46` (pre-translation), `S-O-50…58` (prompts), `S-O-60…61` (glossary), `S-O-71…74` (cache), `S-O-30` (thinking), `S-O-80…87` (images), `S-P-34 / P10` (configuration fallback), `S-P-48 / S-P-49` (free AI / Microsoft), `P12–P13` (images) | ❌ | After §3.2 was renumbered (S-O-40…49 styles, S-O-50/51 pre-translation, S-O-61/62 prompts and glossary, S-O-70…72 cache, S-O-24…27 images) §8 was not changed back; “three translation services” is now four built-in + the reader's services; the “loading ring” is a skeleton; the “translation style presets” are a configured list |
| L373–382 §9 open items | Item 3 (the two buttons of P8), item 4 (native select or search list for the language row) | ⚠️ decided, not removed | §4 P9 settled the two buttons; S-P-22 settled the search menu |

### 2.7 THIRD_PARTY.md, docs/agents/*, docs/phase0/*, docs/superpowers/*

| Location | Claim | Status | Evidence |
|---|---|---|---|
| THIRD_PARTY L3 | “Every ported file's header carries the same attribution line” | ✅ | 26 files carry `// 移植自 …` |
| THIRD_PARTY L19–36 | 17 registered rows | ⚠️ incomplete | Files whose headers call themselves ported / copied / rewritten and are **not registered**: `src/core/scheduler/lazy.ts` (“the observer skeleton of Read Frog's PageTranslationManager, rebound”), `src/core/scheduler/title.ts` (“a rewrite of the document.title part of Read Frog's page-translation.ts”), `src/providers/thinking.ts` (“copied from KISS's THINKING_API_REGISTRY”), `src/providers/glossary.ts` (“shaped after KISS's parseAITerms”), `src/config/storage.ts` (“borrowed”), `src/providers/request/config.ts` (ported with the directory); the porting relation of `renderer/image.ts` / `image/boxes.ts` to the ImageTrans claimed by DESIGN §15.1 is unclear (see §2.4). The THIRD_PARTY project table lists the ImageTrans snapshot without any file row |
| THIRD_PARTY L29 | `skeleton.ts` “the styles moved to `styles/modes.css`” | ✅ | `modes.css:26-47` |
| THIRD_PARTY L33 | `presets.css` trimmed in v12 | ✅ | The file header agrees |
| codex-review.md | The review signals and process | ⚠️ | A process document, unrelated to code; internally consistent, but entirely dependent on the “PR + Codex bot” workflow (the whole document lapses if the rebuild does not go through PRs, see §4) |
| domain.md | `CONTEXT.md` / `CONTEXT-MAP.md` / `docs/adr/`; `/domain-modeling`, `/grill-with-docs`, `/improve-codebase-architecture` | 🗑 | None of the three files / directories exists; the skill names it cites are mattpocock/skills', never used in this repository; not a character changed since the initial commit |
| issue-tracker.md | `/wayfinder`, `/triage`, the `wayfinder:map` label, “PRs as a request surface: no” | 🗑 | A generic template, never adapted to this repository; the repository actually uses issues + the roadmap #155, no wayfinder |
| triage-labels.md | The five labels | ⚠️ | A template; whether the labels were ever created on GitHub not checked (no network access this time) |
| phase0/rules-audit.md L4 | “RULES_VERSION 0.4.0, 11 papers, 112320 text nodes” | 🗑 | The generated output stopped at 0.4.0 (2026-09-04); now 0.10.1 and 13 fixture files; `pnpm fixtures:stats` regenerates it at any time, no need to keep it in the repository |
| superpowers/plans/2026-09-07-popup-ui.md | “Commit straight to the integration branch `ui/phase-1`, no PR” | 🗑 | The plan is executed (PRs #163–#168 merged); a 1447-line execution checklist with no lasting value; cites `docs/design/canvas/Main.dc.html` (git-ignored, absent from the worktree) |
| superpowers/plans/2026-09-10-settings-services-appearance.md, specs/… | The configuration v12 plan and spec | 🗑 / ⚠️ | Executed; some “[decided]” decisions in the spec (no vendor templates, save on change, built-ins deletable) are recorded only there, and DESIGN §7.5 / §8.5 wrote the conclusions without the reasons |

<!-- section 2 done -->

## 3. Contradictions

Two statements about the same thing. “What is actually the case” follows the code at HEAD.

| # | Location A | Location B | The two statements | What is actually the case |
|---|---|---|---|---|
| 1 | RESEARCH L101 (§2.9), L473–476 (§6.11 “§2.9 still holds for inline SVG”); DESIGN L152 (§5.2), L891 (§15.1) | DESIGN L1003 (§15.6) | A: SVG / TikZ figures hold no translatable text, v1 skips them whole; B: of the 954 `foreignObject`s in 170 inline figures 199 hold real words, connected to the image pipeline | B is the state: `svg/foreign.ts` exists, the comment at `latexml.ts:95` changed; the four A sites were not synchronised |
| 2 | DESIGN L3 (the header “v0.6 moves provider requests to content”), L58 (the architecture diagram with `[cache?]` in content), L829 (Phase 3 “provider requests move to content”) | DESIGN L563–577 (§8.0), L81, L741 | A: requests and cache in content; B: all in the background | B (`shared/transport.ts` is only a message proxy; `background/index.ts` holds the chain and Dexie) |
| 3 | DESIGN L710 (§8.4 “content calls `FallbackService.reset()`”) | DESIGN L734 (§8.5 “`FallbackService` has no `reset()`”); `fallback.ts:38` | Has / has no `reset()` | None; `axt:engine-ready` rebuilds the whole chain |
| 4 | DESIGN L700 (§8.3 “google-web's rate pressed down to 2 requests/s, burst 2; **no batching** (only the LLM batches)”), L783 (§10 “only the LLM batches”) | DESIGN L682 (§8.3 “`maxConcurrent: 2`, `rate: 20 / capacity: 8`”), L665 (§8.2 “every provider gets a `BatchQueue`”) | Two sets of numbers, batching yes / no reversed | `google-web.ts:85-86` rate 20 / capacity 8 / maxConcurrent 2; `translate-service.ts:183-186` every provider batches |
| 5 | DESIGN L920 (§15.2 “`wxt.config.ts` declares no minimum Chrome version”) | DESIGN L464 (§7.4b “this project's floor of 131”), L529 (§7.7 “`minimum_chrome_version` is 131”); `wxt.config.ts:31` | Whether there is a minimum version | There is, 131 |
| 6 | DESIGN L640 (§8.1 built-in translation “Chrome 138+”), L911 (“the built-in translation API already requires 138+”); the old CLAUDE.md “browser target Chrome 138+” | `wxt.config.ts:31` 131; DESIGN L464 / L529 | 138 or 131 | The install floor is 131 (anchor positioning); on 131–137 built-in translation merely has `isAvailable()` false; the documents never put the two numbers together and explain them |
| 7 | DESIGN L884 (§15 “with the helper undetected … the settings section is **no longer** greyed out whole”) | DESIGN L948 (§15.4 “undetected → the settings item greys out, image translation silently does not run”) | Greyed / not greyed | Not greyed: the install guide is shown (UI.md S-P-86, S-O-27, `HelperSetup.tsx`) |
| 8 | DESIGN L648 (§8.1 “the negotiation of §8.5 is order-dependent; before #103 the primary has to decide the format”) | DESIGN L727–732 (§8.5 “the format is decided by the primary engine, order-independent”, 2026-09-09); the `providers/index.ts` comment | Order-dependent / independent | Order-independent already; L648 predates the change |
| 9 | DESIGN L416 (§7.3 “stack the default layout”), L747 (§9 the v1 shape) | `config/schema.ts:110` `mode: 'side'`; UI.md L99 (S-P-70 “a fresh install defaults to side by side too”) | Default stack / side | side (the owner's decision of 2026-09-11) |
| 10 | DESIGN L863 (§13 the Chinese GPL header template “移植自 …”) | CLAUDE.md L81 (the English “Ported from …”) | Two templates | All 26 files use the Chinese template; 0 the English one |
| 11 | CLAUDE.md L16 (`@ai-sdk/anthropic` / `@ai-sdk/google`), L47 (`anthropic.ts gemini.ts`) | DESIGN L646 (§8.1 “not implemented for now”); `package.json` | These two providers exist / do not | They do not |
| 12 | CLAUDE.md L67 (hard rule 3 `preservesMarkup`) | DESIGN L32, L43–44 (the `wireFormats` set, three paths); `providers/types.ts:66` | A boolean / a set | A set; `preservesMarkup` no longer exists |
| 13 | CLAUDE.md L47, L68 (`google-gtx`) | DESIGN L17, L652 (gtx not connected, `google-web`) | gtx / translateHtml | translateHtml (`google-web.ts`) |
| 14 | CLAUDE.md L15 (the injected overlay uses WXT `createShadowRootUi`) | DESIGN L833 (PR 2b “switched to a few dozen lines of native DOM + Shadow DOM”); `renderer/failed.ts` | Uses / does not use WXT's Shadow UI | Does not; native `attachShadow` |
| 15 | CLAUDE.md L220 (“repository-root `CONTEXT.md` + `docs/adr/`”) | `docs/agents/domain.md` L11 (“skip silently if absent”); the file system | Exist / do not | Do not |
| 16 | DESIGN L757 (§10 settings page “pre-translation distance (0–10000px, step 100)”, “visibility threshold (0–1)” number boxes) | UI.md L159–160 (S-O-50/51 steps 半屏…三屏 / 刚露出…完全露出); `Reading.tsx:98-109` | Number boxes / steps | Steps |
| 17 | DESIGN L749 (§9 configuration fallback “a red warning hung at the top of the popup”) | UI.md L114 (S-P-34 removed), L125 (S-O-02 at the top of the settings page) | popup / settings page | The settings page |
| 18 | DESIGN L710 (§8.4 “the download entry only in the popup”) | UI.md L128 (S-O-11 “下载” on the Chrome card of the settings page); `Services.tsx:31` | One place / two | Two |
| 19 | DESIGN L565, L600 (“the settings page's connection test / 测试连接”) | UI.md L47, L136 (“连接” = save + verify, no save button) | Test connection + save / one “连接” | One “连接”, save on change |
| 20 | DESIGN L637 (§8.1 openai-compat “OpenRouter (the default endpoint) … the default model is a cheap fast tier, changeable on the settings page”) | DESIGN L721 (§8.5 “no vendor templates, the reader fills in three fields”); UI.md S-O-16; `schema.ts:106` `services: []` | A default endpoint and model exist / do not | They do not; the `openrouter.ai` in `host_permissions` is a leftover |
| 21 | UI.md L331 (§7 “§8.1 the default provider becomes `google-web`”) | UI.md L91 (S-P-46 “Microsoft is the shipped default”); `schema.ts:105` | google-web / microsoft | microsoft |
| 22 | UI.md L114 (“Removed 2026-09-10: … S-P-34”) | UI.md L356 (§8 “configuration read failure notice … S-P-34, P10”) | Removed / still listed | Removed; the id column of §8 was not renumbered with §3 at all (see §2.6) |
| 23 | DESIGN L604 (the provider id union of five literals) | DESIGN L642 (`microsoft`), L721 (the service id as the engine id); `types.ts:58` `id: string` | A closed / open id | Open |
| 24 | DESIGN L740 (§9 the seven-part cache key, “`CACHE_KEY_VERSION` bumped to 3 … to 4 at the rename”); CLAUDE.md L70 | DESIGN L662 (§8.2 `promptKey` and the context in the key); `cache/key.ts:1,70` | Seven / nine parts; version 4 / 6 | Nine parts + `CACHE_KEY_VERSION = 6` (5: sentence markers in the key, 6: §8.6) |
| 25 | DESIGN L747 (configuration up to v12) | UI.md L308 (“configuration v13 adds `uiLanguage`”); `schema.ts:9` | v12 / v13 | v13 |
| 26 | DESIGN L531 (§7.7 sentence boundaries “reported only by Microsoft at present”) | DESIGN L555 (“Microsoft, and Google after #137”); `providers/sentence-markers.ts` | One engine / two + markers inserted by the service layer | The latter |
| 27 | DESIGN L119, L802; RESEARCH L13 (“10 fixtures”) | DESIGN L158, L166 etc. (“12”); `tests/fixtures/arxiv/` | 10 / 12 | 12 + 1 synthetic |
| 28 | RESEARCH L280 (“gtx declares `preservesMarkup: true`; translateHtml not worth a provider of its own”), L756 (§7 line 16) | RESEARCH L360 (§6.6), L762 (line 23); DESIGN L652 | Use gtx / use translateHtml | translateHtml |
| 29 | RESEARCH L160 (§3.2 “side only needs `--main-width` overridden”), L752 (line 12) | DESIGN L407 (“overriding `--main-width` alone without touching the tracks overflows horizontally”) | One variable / rewrite the body grid with three tokens | The latter |
| 30 | RESEARCH L616–630 (§6.11 “v1 draws only multiples of 90°, `quarterTurn`”) | DESIGN L986 (§15.5 “every run is drawn, along its own axis”, 2026-09-11) | Drop / draw | Draw; `quarterTurn` no longer exists |
| 31 | CLAUDE.md L199 (`fixtures:stats` “to be created”) | RESEARCH L6, L25 (the script is in use) | To be created / exists | Exists |
| 32 | DESIGN L143–147 (§5.2 lists `math` / `.ltx_tag` / `.ltx_font_typewriter` as skipped) | DESIGN L224 (§5.6 “`math` appears only in PROTECT”), L239 (§6.1 void); `latexml.ts:133-137` | skip / protect | protect |
| 33 | DESIGN L703 (§8.3 the “instant engine” written as a settled convention, “the user can turn it off in settings”) | DESIGN L699, L722 (the chain falls back only on failure); RESEARCH L758 (line 21 is only a suggestion, “whether to adopt depends on the trade-off”); `fallback.ts` | Built-in first then LLM replaces / a pure fallback chain | A pure fallback chain; no switch |
| 34 | DESIGN L539 (§7.7 “`styleVarsRule` rewrites `--axt-green` from `config.style.accent`”), L489–493 (the §7.5 v9 passage) | DESIGN L481 (§7.5 “`data-axt-style` and `--axt-accent` retired … `appearanceRule()`”); `style-preset.ts` | v9's `style` / v12's `appearance` | v12 |
| 35 | DESIGN L302 (§7.1 “the original node may only gain `data-axt-id` / `state` / `inline`”) | DESIGN L187 (`data-axt-partial`), L325 (`data-axt-note`), L432 (`data-axt-identity`); the attribute count | Three / six or more | Six or more (all with the `data-axt-` prefix; the spirit holds, the list is void) |
| 36 | DESIGN L208 (§5.4 the year “wrapped in its own paired placeholder”) | `latexml.ts:153-158` (`bib-year` as a void, Codex #74) | paired / void | void; the §6.1 list does not register it |
| 37 | 18 code sites citing “§8.6” (`cache/key.ts:49,65`, `types.ts:11,82`, `translate-service.ts` ×7, `microsoft.ts:175`, `latexml.ts:283`, `pipeline/sentences.ts`, `run.ts:172`, two tests) | DESIGN's heading list: §8 has only 8.0–8.5 | §8.6 exists / does not | **DESIGN has no §8.6**; the design of sentence alignment / sentence markers lives only in code comments |

<!-- section 3 done -->

## 4. Mistaken constraints

“Introduced by” is the first commit found with `git log -S`. The “must keep?” column marks only requirements that do not change with the rebuild: security, privacy, licence, API keys and DOM reversibility.

| Location | Rule | Introduced by | Still holds? | Suggestion | Must keep? |
|---|---|---|---|---|---|
| CLAUDE.md L5; DESIGN L5; UI.md L3 | “DESIGN.md is the single source of truth; any implementation that conflicts with it is wrong; to change the design, change the document first” | `eccef7a` 2026-09-03, the initial commit | ❌ Overturned by the facts: the code has a §8.6 DESIGN lacks, and the default mode / default service / cache key version / configuration version all disagree with it (§2, §3); it also conflicts outright with the rebuild rule “old documents are evidence, not templates” | Rewrite as “DESIGN.md / UI.md are the design record from before the rebuild; during the rebuild the ADRs + the behaviour baseline rule, and the new source of truth is decided once the rebuild is done” | No |
| CLAUDE.md L10 | “Stack (fixed, do not choose another)” | `eccef7a` | ⚠️ The stack itself is stable, but three items in the table are wrong (the AI SDK packages, `createShadowRootUi`, Tailwind missing) | Make it a factual “current stack” table; keep only the constraints with a reason (MV3, Chrome ≥131, no polyfills) | No |
| CLAUDE.md L26 | “Do not implement from scratch: request queue, retry backoff, hash, storage wrapper, tolerant JSON parsing” | `2ae9764` 2026-09-03 | ⚠️ All ported by now, the rule is “used up”; if the rebuild rewrites these modules the rule would force copying them again | Change to “the following modules are ported; keep the attribution when changing them” | No (the attribution part, see below) |
| CLAUDE.md L77–82; DESIGN L861 | “Port from the reference repositories by default; only three kinds of exception are original” | `2ae9764` | ❌ The project has diverged far from the reference implementations (renderer / protector / svg / image / sentences are all original, and the “not ported” list of DESIGN §12 proves case-by-case judgement is the practice); `reference/` does not exist in the worktree (git-ignored) | Change to “the reference repositories are a source of evidence; whether to port depends on whether there is a downside (the owner's memory already holds this criterion)” | No |
| CLAUDE.md L81; DESIGN L863; THIRD_PARTY | The GPL §5 attribution line + the THIRD_PARTY register | `2ae9764` | ✅ A legal requirement | Keep; settle on one template (all Chinese today, CLAUDE.md demands English); fill the gaps listed in §2.7; add the LICENSE file | **Must keep** |
| CLAUDE.md L88 | “A module over 100 lines starts in plan mode, the plan citing DESIGN.md sections” | `eccef7a` | ❌ Designed for starting from zero; every module in the rebuild exceeds 100 lines, and “cite DESIGN sections” conflicts with the item above | Replace with the rebuild's own planning rhythm (charter / ADR / PROGRESS) | No |
| CLAUDE.md L89–107 | “One module per branch / PR, and small” + the Codex round statistics of nine PRs | `eccef7a` (the rule); `67711a5` / `941d1c2` / `ed456b3` 2026-09-09 (the data) | ⚠️ The data is real but holds only for the “every PR through Codex” process; ui/phase-1 already bypassed it with an integration branch; the rebuild is on the `rebuild/v1` branch too | Move the table to an ADR or codex-review.md as reference; change the rule to “the unit merged into main has to be small” | No |
| CLAUDE.md L108–114 | The three self-checks (four-step gate + e2e, grep after adding a constraint, read the diff as someone else's); one review request per fix batch | `67711a5` | ✅ The first three are general hygiene; “one review” is Codex-specific | Keep the three self-checks, drop the Codex wording | No |
| CLAUDE.md L115–129 | “Do not wait on review to start the next independent PR” + the dependency criterion | `7aa3801` 2026-09-09 | ⚠️ Holds only for a PR queue | Shrink to one sentence “when branches have a type / behaviour dependency, branch from the upstream branch” | No |
| CLAUDE.md L130–138 | “Measure in parallel with subagents, implement yourself” | `7aa3801` | ⚠️ A lesson from experience whose reason still holds (context completeness) | Demote to advice | No |
| CLAUDE.md L139 | The gate `typecheck && lint && test && build`, matching CI | `eccef7a` (three steps) → typecheck added 09-08 | ✅ | Keep | Suggested keep |
| CLAUDE.md L140, L210–212; codex-review.md | Wait for Codex's terminal signal before merging | `eccef7a` | ⚠️ The owner's memory confirms the preference; but it applies only when a PR is opened | Keep as “wait whenever a PR is opened”; not for commits inside the rebuild branch | Owner preference, keep |
| CLAUDE.md L141–142 | “On a [待验证] item, measure first and write RESEARCH”; “when DESIGN disagrees with measurement: stop, record, do not change the design silently” | `eccef7a` | ❌ DESIGN has no [待验证] left; “do not change the design” conflicts with the rebuild rules | Replace with the rebuild's evidence rule: on a disagreement write it into INVENTORY / an ADR, then change | No |
| CLAUDE.md L143–160 | Developer-visible text always English; three kinds of Chinese exceptions | `49759c4` 2026-09-09 | ✅ The owner's memory confirms it | Keep; drop stale numbers like “858 lines / 656 lines” and the incremental “convert what a change touches” note (the rebuild rewrites whole files) | Owner preference, keep |
| CLAUDE.md L164–181 | The Phase 0 task list (seven items) | `eccef7a` | 🗑 All done | Delete; one sentence “Phase 0 is done” in the RESEARCH.md header suffices | No |
| CLAUDE.md L185–200 | The commands | `eccef7a` | ❌ 7 scripts missing, “to be created” stale | Regenerate from `package.json` | No |
| CLAUDE.md L204–220; docs/agents/{domain,issue-tracker,triage-labels}.md | The four agent skills | `eccef7a` | 🗑 Three are mattpocock/skills templates, never adapted (`/wayfinder`, `CONTEXT.md`, `docs/adr/` do not exist) | Delete domain / triage; shrink issue-tracker to one sentence “issues and the roadmap #155 through `gh`”; keep codex-review | No |
| CLAUDE.md L65 hard rule 1; DESIGN §7.1 | The DOM invariants (sibling insertion, original nodes gain only `data-axt-*`, equal node for node after restore) | `eccef7a` | ✅ The core product promise, with tests; but §7.7 relaxed it in two places (the band layer and the panel on `<body>`), and the list form (three attributes) is void | Keep the principle, rewrite as “the original document subtree is not changed, everything injected is prefixed, `restore()` is equal node for node” and write the relaxations in | **Must keep (product invariant)** |
| CLAUDE.md L66 hard rule 2 | `ltx_*` only in `rules/latexml.ts` + CSS | `eccef7a`; the test 2026-09-06 | ✅ Guarded by `selector-boundary.test.ts` | Keep | Suggested keep |
| CLAUDE.md L67 hard rule 3 | `preservesMarkup` decides the path | `eccef7a` | ❌ The field became `wireFormats` | Rewrite as “the path is negotiated from the provider's declared `wireFormats`; no provider special cases in the renderer” | No (the principle stays, the wording changes) |
| CLAUDE.md L68 hard rule 4 | Free APIs in their own files, their own error types, recoverable failure | `eccef7a` | ✅ The principle holds; the file names are wrong | Fix the file names | Suggested keep |
| CLAUDE.md L69 hard rule 5 | The `axt-` / `data-axt-` / `--axt-` prefixes | `eccef7a` | ✅ | Keep | Suggested keep |
| CLAUDE.md L70 hard rule 6 | The cache key must hold seven parts; bump the version on a prompt / rule change | `eccef7a` | ✅ The principle holds; the list lacks `promptKey` / `context` / `CACHE_KEY_VERSION` | Update the list | Suggested keep |
| CLAUDE.md L71 hard rule 7; DESIGN L575, L740, L747 | API keys only in WXT storage, never in logs / cache keys / fixtures / git; never in the content world | `eccef7a` | ✅ | Keep; decide along the way whether the KISS public key constant at `google-web.ts:13` counts as “in git” (RESEARCH L219 says it is a public key) | **Must keep (privacy)** |
| DESIGN L6 | The marker legend [决定] / [待验证] / [延后] | `eccef7a` | ⚠️ [待验证] has no instance left | The rebuild documents use another set of status words | No |
| DESIGN L14–22 | The v1 scope: Chrome only, `arxiv.org/html/*` only, the non-goal list | `eccef7a`; image translation added 09-07 | ✅ A scope decision, not a mistaken constraint | Keep (the rebuild charter cites it) | Scope, keep |
| DESIGN L30, L840, L865 | No generic DOM walker; other sites left to v2 | `eccef7a` | ✅ A scope decision | Keep | Scope, keep |
| DESIGN §12 (L806–847) | The phase plan Phase 0–4 | `eccef7a`, 09-05 | 🗑 The plan is executed, with wrong items (Phase 3 “move to content”, Phase 2 `generateObject`, the unticked Phase 0 checkbox) | Archive the whole section; keep the “trade-offs of what was not ported” passage (L834–840) as ADR material | No |
| DESIGN §6.4 L280 | Clones carry no behaviour (`on*`, `javascript:`, `data:text/html` removed) | The audit of 2026-09-11 | ✅ A security invariant | Keep | **Must keep (security)** |
| DESIGN §7.4b | Translations marked `lang` / `dir`; decorative copies `aria-hidden` + `inert`; accessibility fixed without changing the original document | 2026-09-06 / 09-11 | ✅ | Keep | **Must keep (accessibility)** |
| DESIGN §7.5 L491, L495 | The colour allowlist `sanitizeColor`; advanced CSS refuses `{ } @ <` | 2026-09-08 / 09-10 | ✅ Against slips (the author calls it no security boundary) | Keep | Suggested keep |
| DESIGN §8.0 L575 | API keys never enter content-script memory | 2026-09-06 | ✅ | Keep | **Must keep (privacy)** |
| DESIGN §15.4 L949 | `nativeMessaging` a required permission for now, optional at distribution | 2026-09-07 | ✅ The decision still holds, pending distribution | Keep | No (permission policy, decided at distribution) |
| codex-review.md L68 | Merge method fixed: merge, no squash; ask the owner before merging | 09-05 | ✅ Owner preference (memory confirms) | Keep | Owner preference, keep |
| UI.md L343 | “Every feature added to the main line registers a row in §8 first; a feature without a place is not designed” | 2026-09-07 | ⚠️ The principle is fine, the table is void | Keep the principle, redo the table | No |
| UI.md §1 L12 | The interface never shows words like provider / engine / fallback / block / session | 2026-09-07; guarded by `tests/ui/strings.test.ts` | ✅ The owner's memory confirms it | Keep | Owner preference, keep |

<!-- section 4 done -->

## 5. The line-by-line status of RESEARCH.md §7 “DESIGN.md revision list”

The table is at RESEARCH L739–767; the row numbers are not consecutive (1–17, 21, 18, 19, 22, 23, 20, 24–27, in file order). Status: ✅ done · ⚠️ partial / superseded by a better scheme · ❌ not done or reversed · 🗑 voided by a later row.

| # | Item | Status | Where / note |
|---|---|---|---|
| 1 | §5 drop [待验证] | ✅ | No marker anywhere in DESIGN |
| 2 | Delete the three rules `.ltx_abstract .ltx_p` etc. | ✅ | DESIGN L127 “no separate rule”; `UNIT_RULES` has only `.ltx_p` |
| 3 | Add `.ltx_acknowledgements`, `.ltx_keywords`; fold `.ltx_subtitle` into headings | ✅ | DESIGN L128, L133–134; `latexml.ts:36,44,45` |
| 4 | `.ltx_p` may be a `<span>` | ✅ | DESIGN L127 |
| 5 | Nested blocks in footnotes | ✅ | DESIGN L112, L130; `descend: true` |
| 6 | `.ltx_author` / `.ltx_date` do not exist, replace with `.ltx_creator …`; keep `.ltx_authors` / `.ltx_contact` | ⚠️ superseded | The author area was switched to translated by default on 2026-09-04 (DESIGN L136), and the skip table has no author-area entry left; `.ltx_date` came back as `authorinfo` because of the synthetic fixture (`latexml.ts:50`) |
| 7 | Add the skips `.ltx_pubnotes`, `svg, .ltx_picture`, `.ltx_listing_data` | ✅ | DESIGN L146, L151–152; `latexml.ts:87,92,95` (`svg` now goes to the image pipeline, the rule is still skip) |
| 8 | Nothing outside the root is extracted; no header / footer selectors listed | ✅ | DESIGN L121 |
| 9 | The numeric-cell regex corrected | ✅ | DESIGN L189–191 |
| 10 | LaTeXML versions: keep the fork mechanism, fixtures record the generator version | ✅ | DESIGN L217 |
| 11 | The §6.1 voids must enter `PROTECT_RULES` | ✅ | DESIGN L239; `latexml.ts:132` |
| 12 | §7.2 overrides the width with `--main-width` | ⚠️ superseded | DESIGN L407: overriding the variable alone overflows, changed to rewriting the body grid with three tokens; this RESEARCH row is itself stale (§3 item 29) |
| 13 | The auto-fallback threshold becomes 1280px | ✅ | DESIGN L408; `responsive.ts:6` |
| 14 | grid only for `.ltx_para > p.ltx_p`, the rest falls back to stack | ⚠️ superseded | DESIGN L341 changed to structural judgement + subgrid, covering far more than this; `span.ltx_p` / inside tables still stack (L394) |
| 15 | `google-gtx` `preservesMarkup: true` | 🗑 | gtx not connected; the field became `wireFormats` |
| 16 | translateHtml not recommended as an addition | ❌ reversed | Overturned by line 23 of the same table and §6.6; this row is not marked void |
| 17 | `chrome-builtin` keeps tags; the `isAvailable()` convention; the uncertain-state hint; the “。 ” normalisation | ✅ | DESIGN L640, L707–712 |
| 21 | The built-in engine as an instant engine for the first viewport, replaced when the LLM arrives | ❌ | DESIGN L703 writes it as [决定], but the code has no “built-in first, then replace” double write, the chain falls back only on failure (§3 item 33); either delete L703 or make it a project |
| 18 | §11 “fixtures cover several years” → “several fields and structures” | ✅ | DESIGN L802 |
| 19 | §14 the arXiv JS risk lowered to low | ✅ | DESIGN L878 |
| 22 | ~~fetch moves to content~~ | ✅ marked void | Consistent with 24 |
| 23 | Replace gtx with translateHtml | ✅ | DESIGN L652; `google-web.ts` |
| 20 | ~~Skip SVG whole~~ superseded by 27 | ✅ marked | — |
| 24 | Requests run in the background, the transport extracted | ✅ | DESIGN §8.0; issue #42 |
| 25 | The Microsoft channel can be connected with `['markers']`, moved out of the non-goal table | ✅ | DESIGN L22, L642 |
| 26 | Providers gain a “can the target language be translated” check; `buildChain` and the settings page filter by it | ✅ (in another form) | DESIGN L650 decided to reuse `isAvailable()` without a new member; the support table of `microsoft.ts`; UI S-P-32c / S-P-44 |
| 27 | §15.1 “skip SVG” narrowed to inline SVG; external SVG goes through glyph reading | ✅ and exceeded | DESIGN §15, §15.5; §15.6 then connected inline TikZ to the image pipeline too — RESEARCH row 27 and §6.11 L473–476 now **underestimate** the scope |

Also: the “Revision to DESIGN.md §15.1” at the end of RESEARCH §6.11 (L724–731) ✅ done.

<!-- section 5 done -->

## 6. Naming consistency

Known conventions: the display name **Read arXiv** (with a space); the repository / domain **ReadarXiv** / readarxiv.org (UI.md L68, L375).

| Occurrence | Spelling | Consistent? | Note |
|---|---|---|---|
| `wxt.config.ts:21` (manifest `name`) | Read arXiv | ✅ | — |
| `src/locales/en.ts:10`, `zh-CN.ts:8`, `index.ts:14` | Read arXiv | ✅ | — |
| UI.md L68, L375 | Read arXiv / ReadarXiv / readarxiv.org | ✅ | The source of the convention |
| UI.md L68 (quoting the roadmap #155 “the product becomes Readarxiv”) | Readarxiv | ⚠️ | A third capitalisation inside a quotation; UI.md itself explains “the identity is not a string” |
| `src/ui/strings.ts:159,161` | ReadarXiv | ✅ | The repository URL in the install command |
| `helper/README.md:12` | `SRjoeee/ReadarXiv` | ✅ | The repository URL |
| `helper/README.md:17` | `~/Library/Application Support/Readarxiv/helper` | ❌ | The directory name on disk uses the third capitalisation **Readarxiv** (the path the install script really writes, visible to the reader; inconsistent with the repository name ReadarXiv) — check the string `helper/install*.sh` actually uses |
| `docs/superpowers/plans/2026-09-07-popup-ui.md:16`, `…settings-services-appearance.md:498` | Readarxiv | ❌ | The plan documents were written on 09-10, before the naming on 09-11; the documents can be archived |
| CLAUDE.md L1, DESIGN.md L1 | arXiv HTML Translator | ❌ | The old name; the titles of the two main documents not changed |
| `helper/Package.swift:2` | arXiv HTML Translator | ❌ | The old name (a comment) |
| `package.json:2` | `arxiv-html-translator` | ❌ | The old slug, `version 0.0.0`, no `license` / `description` field |
| `docs/phase0/rules-audit.md:2` | `/Users/cheongzhiyan/Developer/ArxivTranslate` | ❌ | The generated report committed a local absolute path (the old directory name ArxivTranslate) into the repository |
| `public/_locales/{en,zh_CN}/messages.json` | Description only, no name | ✅ | The name comes from the manifest |
| README.md / LICENSE | **do not exist** | ❌ | The repository front door (#167) not done; DESIGN L863 calls itself GPL-3.0 but there is no LICENSE file |
| The `axt-` prefix, `axt-helper` | — | ✅ | An internal prefix, unrelated to the product name, no change needed |

Conclusion: the display name and the repository name agree in the code; **three old names** (CLAUDE.md, DESIGN.md, Package.swift), **one slug** (package.json) and **one third capitalisation** (the helper install directory `Readarxiv`) need unifying.

<!-- section 6 done -->

## 7. Not understood, or to be verified

1. **What §8.6 actually is**: 18 code sites cite “§8.6” (sentence alignment / sentence markers / the reason for `CACHE_KEY_VERSION` 5→6), and DESIGN has no such section. The rebuild has to reconstruct it from the comments of `cache/key.ts:49-65`, `providers/types.ts:11,82`, `translate-service.ts:244-261`, `providers/alignment.ts`, `providers/sentence-markers.ts`, `core/sentences/index.ts` and write it as an ADR.
2. **Whether ImageTrans was really ported**: DESIGN §15.1 L894 says the overlay is ported from ImageTrans's `getImage.js`, but the headers of `renderer/image.ts` / `image/boxes.ts` have no attribution line, THIRD_PARTY has no file row, and §15.2 L911 says its font-size algorithm is not used. `reference/` does not exist in the worktree (git-ignored), so no comparison is possible; this is a GPL §5 compliance question to settle before the rebuild (a rewrite → fix the document; a port → register it).
3. **The other gaps in THIRD_PARTY** (§2.7): the headers of `scheduler/lazy.ts`, `scheduler/title.ts`, `providers/thinking.ts`, `providers/glossary.ts`, `config/storage.ts`, `request/config.ts` call themselves ported / copied / rewritten but are not registered; somebody has to judge where “rewritten so far it no longer resembles the original file” begins.
4. **The relation of the two numbers**: the manifest's `minimum_chrome_version: '131'` (anchor positioning) and “built-in translation 138+” are never explained in one place; the behaviour on 131–137 (the built-in engine never available; what the popup says) not checked.
5. **The hard-coded `API_KEY` at `google-web.ts:13`**: RESEARCH L219 calls it KISS's built-in public key. Hard rule 7 “API keys never enter git” is violated to the letter; the owner has to classify it (a public-constant exemption, or fetched at runtime).
6. **`paperContext()` cut to 1200 characters** (DESIGN L661): no literal 1200 seen in `pipeline/paper.ts`; possibly made a constant or changed, not read closely.
7. **`cacheId = openai-compat:<origin><path>`** (DESIGN L740): whether it is still used after v12's “the service id is the engine id” not checked (the `types.ts:95` field is still there).
8. **The popup state table P0–P15** (UI.md §4) against `popup/view-model.ts` state by state not checked; `fixtures.ts` has 17 `P<n>` references.
9. **On the GitHub side** (no network access): whether the triage labels exist; the state of the roadmap #155 and #167; whether the two RESEARCH `[待验证]` items (L413 cold start, L434 worker survival during a 429 backoff) and L436 (`Translator.create()` in the worker), three open measurements, are tracked in issues.
10. **The reminder's CLAUDE.md differs from HEAD** (it has the “Chrome 138+” paragraph, the three-step gate, the Chinese attribution template): `git log -S"Chrome 138+" -- CLAUDE.md` is empty, so that passage was never committed — it comes from the uncommitted `M CLAUDE.md` in the main checkout (the git status at session start). Which copy the owner wants needs confirming.
11. **Stale references in code comments** (outside the document scope, noted in passing): `wxt.config.ts:4` “host_permissions arrive when Phase 3 connects the network engines”; `renderer/index.ts:53,76`, `content/index.ts:87` mention `data-axt-style` (retired); `tests/svg/glyphs.test.ts:49` “corpus has exactly two orientations” (RESEARCH §6.11 corrected it to 42 angles).
12. **The standing of DESIGN §7.5 L489–493**: it describes v9's `style.color / opacity / accent` and `styleVarsRule` without a “historical” mark; whether v12's `appearance` fully inherited the three disciplines “do not change modes.css, write no inline style on `<html>`, the `sanitizeColor` allowlist” has to be confirmed by reading `style-preset.ts`.
13. **The id column of UI.md §8** is void across the board (§2.6), but I did not renumber it row by row — it has to be redone together with the §3 table, not by fixing a few numbers.
14. **The capitalisation of the helper install directory** (§6): check the path `helper/install-remote.sh` / `install.sh` really write; the README may only be a slip.

<!-- section 7 done -->

## Statistics

- Documents read: CLAUDE.md 220 + DESIGN.md 1015 + RESEARCH.md 767 + UI.md 382 + THIRD_PARTY.md 38 + agents 194 + rules-audit.md 656 (sampled) + superpowers 2257 (headers sampled) ≈ 5529 lines; DESIGN / RESEARCH / UI / THIRD_PARTY / agents read in full.
- Claim checks: about 58 ❌ (CLAUDE.md 15, DESIGN 30, RESEARCH 5, UI.md 6, others 2), about 60 ⚠️, about 14 🗑.
- Contradictions: 37 pairs.
- Mistaken constraints: 33 items, 6 of them marked “must keep” (GPL attribution, API keys, the DOM invariants, clones without behaviour, accessibility attributes, keys never in content).
- Unit tests actually run: 109 files / 1518 passed (DESIGN says “1400-odd”).

<!-- audit complete -->
