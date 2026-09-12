# Behavior baseline (v0.3.0-mvp, `main` @ 8cfd771)

Recorded 2026-09-12 on the untouched baseline so that every later "faster", "smaller" or "still correct" claim has a number to stand against (charter §6). Apple Silicon Mac, Node 22, Playwright's Chrome for Testing 153; the free engines (Google web, Microsoft Edge) were live for the browser suites.

## Gate — what CI runs (`.github/workflows/ci.yml`, ~2 min there)

| Step | Result | Wall here |
|---|---|---|
| `pnpm typecheck` | clean | 2 s |
| `pnpm lint` | 279 files, clean | 2 s |
| `pnpm test` | 111 files, **1 546 tests**, all green | 22 s (103 s CPU across workers) |
| `pnpm build` | 1.25 MB bundle, `check-output` clean | < 1 s warm |

## Browser suites — not in CI, run by hand

| Suite | Result | Wall | Protects |
|---|---|---|---|
| `pnpm e2e` | **67/67** | 181 s | whole-page translation with Google and Microsoft, batching and concurrency caps, cache hits on refresh, restore, tab close / navigation cancel, wrong-key fallback on and off, hover highlight, only-mode peek and anchors, SVG overlays, options persistence, UI language switch, helper onboarding (macOS) |
| `pnpm e2e:layout` | **23/23** | 80 s | side-mode layout contract at 1440 / 2000 px, list markers, flex figures, footnotes, resizebox tables, mode round-trip, observer thresholds, **long-task and prep budgets** |
| `pnpm e2e:a11y` | **5/5** | 31 s | A/B axe: the extension introduces no finding the host page did not already have, in all three modes |
| `pnpm e2e:local-endpoint` | **5/5** | 5 s | an http endpoint without CORS headers translates a whole page from the background (#42): zero preflights, zero page-origin requests |
| `pnpm e2e:image` | not run this pass | — | needs macOS and an installed helper; prints SKIP otherwise |
| `pnpm e2e:placeholders` | not run | — | a live-engine survival probe, not a regression suite |

## Numbers to hold or beat

Layout and prep (2312.17141, 392 equation tables, side mode):

- Long tasks: **longest 221 ms, total 353 ms, 2 tasks** (budget ≤ 400 ms / ≤ 1.5 s).
- Side prep per session: **233.5 ms over 6 passes** — mirrors 185.9, tables 35.6, notes 6.4, split 5.4, margins 0.2 (budget < 600 ms; before #46: 1 912 ms over 31 passes).
- After settling: 359 mirrors, 418 pairs, 0 misaligned; side → stack → side keeps 359 mirrors, 423 pairs, 0 misaligned.
- 1440 px: columns 468 / 468, article 992, no horizontal overflow; 290 equation tables, 114 scaled or scrolled, 0 overflowing. 2000 px: 740 / 740, article 1 536, 0 scaled.
- Frontmatter footnotes paired at 1400 / 1500 / 1800 px, 0 overlaps; abstract-to-body spacing unchanged (32 px).

Translation (2410.00260, 292 blocks):

- Google web, first screen: 11 blocks, 56 ms with cache, 0 failed. Full page: 290 / 290 blocks in 6 989 ms; **45 requests carrying 329 segments (7.3 per request)**; in-flight peak 2 (= `maxConcurrent`), 9 per second.
- Refresh: 0 endpoint requests, 49 ms.
- Microsoft, first screen: 655 ms; 21 / 21 protected nodes preserved across 14 pairs; 0 marker residue.
- Restore: 0 translations, 0 `data-axt-*` attributes after a full attribute sweep; 83 nodes removed; 0 new requests within 0.5 s.
- Tab closed / navigated away with 105 / 530 blocks pending: 0 new requests after the slots reopen.
- Wrong key, fallback on: page finishes on the free engine, 3 OpenRouter requests total; fallback off: 3 requests before the first 401, **0 after**.

Reading aids:

- Hover highlight: one band per line (3 lines → 3 bands), 0 bands in the 423 px of trailing whitespace, DOM untouched, layer on `<body>`; removing 16 translations leaves 0 registry entries alive.
- only-mode peek: dwell 600 ms honoured; margin placement at 1600 px, below-sentence at 1100 px with width = block width; **0.005 ms per paragraph clone**; closes on scroll.
- SVG figures: 10 overlays, 12 / 12 nested documents readable, 5 rotated axis labels, max uncovered fraction 0.0007.
- Anchors in only mode: 128 targets hidden, the click lands on the translation.

Accessibility: stack 572 axe findings, side 592, only 402 — **all present on the untranslated page**; 8 `scrollable-region-focusable` in side mode verified keyboard-reachable and exempted.

## Not covered by any of the above (see `INVENTORY.md` §4.5)

- The options page below the section level: `ProfileEditor` (every field), the highlight-profile grid, the glossary textarea, `PromptManager` edit / import / export / token insertion, `ServiceDrawer` "delete service" and "more options / thinking".
- Popup menus clicked end to end (only the pure view-model is unit-tested; the options-page twins are clicked instead).
- `entrypoints/content/index.ts`, `popup/data.ts`, `options/data.ts` under vitest — their guards have no assertions.
- Cost of the highlight `MutationObserver` during translation bursts; `lazy.ts release()` at 880 blocks; `putMany` per batch.
- Service-worker recycle during a session (the `revision` misreport, INVENTORY S8); the image pipeline on this run.

## Core user tasks the rebuild keeps verifying (charter §6)

1. Open a paper; the first screen translates without scrolling; scrolling to the end translates every block; nothing off-screen is requested.
2. Switch side / stack / only without re-translating; side keeps pairs aligned and tables inside their column.
3. Restore the original: the DOM equals the pre-translation DOM, no attributes remain, no requests follow.
4. Close the tab or navigate away: the background stops sending.
5. Wrong API key: with fallback on the free engines finish the page and the popup says so; with fallback off the session stops after the first 401.
6. Refresh: cached blocks render with zero endpoint requests.
7. Change appearance, target language or service from popup or options: immediate where the design says immediate, a new session where it says so.
8. Hover a sentence: both sides highlight; in only mode the source sentence appears in the panel.
9. Images: SVG labels overlaid without the helper; bitmaps after the handshake; overlays gone on restore.
10. Install the helper from the popup: copy → wait in the background → the wait survives closing the popup and a worker recycle.
