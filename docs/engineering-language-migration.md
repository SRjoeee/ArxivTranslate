# Engineering language migration verification

Date: 2026-09-09. Baseline: `1a6aeba8b58b7d0c7b5d51810132909d81ab62ea`.
Branch: `codex/engineering-english`, in a separate `ArxivTranslate-english` worktree.

The migration covers project-authored engineering text in all Git-tracked text files. It changes documentation, source comments, test descriptions, diagnostics, helper and script output, configuration guidance, extension UI, and extension-owned HTML metadata to English. Existing user edits in the original worktree were preserved.

## Scope

216 changed files: 212 existing files and four additions.

| Area | Files | Changes |
|---|---:|---|
| Source | 88 | Comments, attribution descriptions, errors, logs, popup/options copy, labels, hints, and HTML language/title metadata |
| Tests | 87 | Names, comments, explanations, snapshot names, and text-dependent browser locators/assertions |
| Documentation | 21 | Design/research records, UI/planning/review documents, 12 HTML canvases, attribution register, and this report |
| Scripts | 10 | CLI/report text and the language checker, its tests, and exact exception registry |
| Helper | 4 | README, installer, package comments, and Swift comments/diagnostics |
| Root configuration and guidance | 5 | CLAUDE.md, .gitignore comments, package scripts, Vitest/WXT comments and manifest description |
| CI | 1 | Language gate in the existing workflow |

No dependency versions, lockfile, storage keys, message types, provider IDs, language codes, selectors, or prompt/rule versions were changed. The default translation target remains `cmn`. Actual model prompt templates and their protocol blocks are unchanged. The connection-test sample's project-owned section label is now English; its sample text and protocol remain intact.

The legacy `LANG_CODE_TO_ZH_NAME` export remains for compatibility; only its UI display values now use the existing English language names. The native-name and provider-mapping tables remain unchanged.

Two small presentation adjustments address English length: the thinking option reads “Off (default)” with its full explanation in the existing help text, and each image-mode checkbox stays with its label when wrapping. Canvas repair links have explicit preceding spaces. No product redesign was made.

## Intentional non-English data

[The exact exception registry](../scripts/language-exceptions.json) has 309 entries covering 336 occurrences: 276 test lines, 40 documentation lines, 18 source lines, and two checker-test lines. Each entry identifies one file, the complete unchanged line, its expected occurrence count, and a specific reason. These are reviewed data exceptions, not directory exemptions.

- Translation inputs/outputs, glossary entries, Unicode delimiters, Japanese accessibility samples, and the local-endpoint marker remain exact test data. Test names, instructions, and assertions around them are English.
- DESIGN and RESEARCH retain actual measured translations, including mistakes, because they are evidence for protection rules, provider limitations, and punctuation normalization.
- Canvas reading/connection previews and the options glossary placeholder retain translated sample content. Native language names remain in language selectors.
- Functional regular expressions retain CJK punctuation, width-classification ranges, fullwidth glossary delimiters, and localized third-party Chrome native-host errors.
- Twelve downloaded paper fixtures are byte-for-byte unchanged, verified against SHA-256 baselines. Their mathematical symbols, original author text, generated comments, and host-page language metadata remain source data. Only the project-authored header of the synthetic fixture was translated.
- Other native-script language names and multilingual test data remain intact. The guard deliberately does not ban all non-ASCII characters.
- License files, copyright notices, upstream identifiers, source versions, and historical modification records are preserved. [THIRD_PARTY.md](THIRD_PARTY.md) records this maintenance update.

## Rules and regression gate

The existing [CLAUDE.md](../CLAUDE.md#engineering-language) now requires English engineering text and explicitly supersedes the former Chinese-comment/documentation rule. Other project constraints remain in force; no competing AGENTS.md was introduced.

`pnpm check:language` runs six meaningful checker tests, then scans every tracked UTF-8 text file for Han text and CJK punctuation. It validates the registry schema, rejects unregistered text, rejects changed or stale exceptions, and checks duplicate occurrence counts. Registry metadata cannot introduce an unchecked text field. Binary files are counted separately. The existing [CI workflow](../.github/workflows/ci.yml) runs the gate after type checking.

The scan is a regression guard, not proof of English quality or technical equivalence. Review also covered mixed-language fragments, punctuation, terminology, mandatory constraints, historical uncertainty, code examples, text consumers, links/anchors, and rendered UI. Twelve canvases were rendered for inspection; extension options were checked at 320, 640, and 1024 pixels and the popup at 320 pixels. No horizontal page overflow or clipped controls was found after the small label adjustments.

## Verification

All commands ran in the isolated worktree with the existing dependency lockfile. Local logs, screenshots, audit helpers, and captured network responses are in `/tmp/axt-english-evidence` on the task machine; they are evidence artifacts, not added project dependencies or fixtures.

| Command/check | Baseline | Migrated result |
|---|---|---|
| `pnpm install --frozen-lockfile` | Passed | Existing versions retained |
| `pnpm typecheck` | Passed | Passed |
| `pnpm lint` | Passed, 176 files | Passed, 178 files; no automatic fixes |
| `pnpm test` | 76 files, 994 tests passed | 76 files, 994 tests passed |
| `pnpm build` | Passed, including `check-output.mjs` | Passed, including the output gate |
| `pnpm check:language` | New gate | Six tests passed; 239 text files, three binary files, 336 exact data lines |
| `pnpm helper:build` | Passed | Passed; existing legacy Swift-driver deprecation warning |
| `pnpm helper:smoke` | Passed | Passed, including native framing and actual Vision OCR |
| `pnpm fixtures:stats --json /tmp/axt-english-evidence/fixtures.json` | Existing fixture corpus | Passed; 13 fixtures processed; no canonical data rewritten |
| `pnpm e2e:a11y` | 5/5 passed | 5/5 passed; host-versus-extension accessibility comparison |
| `pnpm e2e:local-endpoint` | 5/5 passed | English options connection check passed; live paper navigation timed out. Exact-fixture replay: 5/5 passed |
| `pnpm e2e` | 23 checks passed, then live navigation timed out | Live runs hit page/font timeouts. Exact-fixture/static-response replay: 27/27 passed |
| `pnpm e2e:layout` | 22/22 passed | Live runs hit navigation timeouts; exact-response replay: 22/22 passed |
| `AXT_HELPER_MANIFEST=/tmp/axt-english-evidence/helper-manifest.json pnpm e2e:image` | 13/13 passed with isolated registration and exact-response replay | Detected rebuilt helper; live run failed to complete overlays and later timed out. Full exact-response replay: 13/13 passed |
| `git diff --check` and relative Markdown link/anchor audit | No broken relative Markdown links found | Passed; no introduced broken relative links/anchors |
| Fixture/protocol/structural audit | Baseline saved | All 12 paper hashes unchanged; prompt AST and protocol literals unchanged; code shape, identifiers, numeric values and regexes preserved apart from reviewed UI grouping |

Browser verification corrected two migration-introduced English substring ambiguities (`Name` and `Model`) with exact textbox selectors. Other short labels now use role-scoped matching. Cache-zero matching retains its numeric boundary. No assertions were removed, made vacuous, or broadened to accept failures. The image test and main test wait for helper detection to finish before checking availability; a pending detection no longer causes a false skip. `AXT_HELPER_MANIFEST` provides an isolated test manifest without changing the user's native-host installation.

Supplemental replay uses the original paper URL and exact committed HTML. Versioned CSS, JavaScript, fonts, and image bytes fetched from their original URLs are cached outside the repository; the layout-only paper absent from the fixture corpus is similarly captured from its original URL. Provider calls, local endpoint traffic, helper execution, screenshots, and every existing assertion remain real. Reproduction on this machine:

```sh
node --import /tmp/axt-english-evidence/fixture-preload.mjs tests/e2e/local-endpoint.mjs
node --import /tmp/axt-english-evidence/fixture-preload.mjs tests/e2e/extension.mjs
node --import /tmp/axt-english-evidence/fixture-preload.mjs tests/e2e/layout.mjs
AXT_HELPER_MANIFEST=/tmp/axt-english-evidence/helper-manifest.json \
  node --import /tmp/axt-english-evidence/fixture-preload.mjs tests/e2e/image.mjs
```

Image replay initially passed 11/13 while image bytes still came from the network (only five of six bitmaps completed). After caching the exact original image responses as well, both the baseline and migrated builds passed 13/13. The temporary baseline harness received only the same isolated-manifest override and helper-readiness wait; its assertions and extension/helper source were unchanged. Neither incomplete run is counted as a pass.

Replay results complement live checks; they do not establish reliable access to arXiv from this environment. Live navigation also timed out in a browser without the extension. No timeouts or assertions were relaxed in the repository to hide those failures.

## Existing discrepancies and limits

The migration preserves historical claims and unresolved decisions instead of changing implementation to fit them. These discrepancies remain for separate work:

- CLAUDE's directory/provider outline includes older paths and planned providers, and its fixture-generation note is stale. DESIGN contains successive, sometimes conflicting decisions about author translation, table/heading layout, marking, reset lifecycle, request ownership, and Google batching. Later dated decisions were preserved beside earlier text.
- RESEARCH's cold-start discussion says the state was unobserved while its revision table says retesting was complete. Its 80 ms summary includes an 81 ms measurement, and its roughly 65 MB estimate differs from listed files totaling 74 M. The no-keepalive finding is limited by its explicit in-flight-fetch caveat. None was silently promoted to a verified general conclusion.
- UI.md and the popup plan assign different meanings to P13, and their priority lists differ. Canvas `support.js` references were already absent; static HTML was rendered, but the design-canvas host integration was not validated.
- Live arXiv page/font loading is intermittent. Replay covers the tested workflows but does not replace a stable live-network run. Browser coverage is Chromium; no Safari/Firefox or packaged store submission was performed. No real-key paid LLM session or fresh Chrome offline-language-model download was added to this language migration.
- GitHub CI itself has not run remotely; its local command sequence was executed. No push, merge, release, or native-host reinstallation was performed.
