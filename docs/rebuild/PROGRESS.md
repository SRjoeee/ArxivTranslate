# Rebuild progress

Checkpoint log for the rebuild toward V1.0 (mandate: `docs/rebuild/CHARTER.md`; governance: `docs/adr/0001-rebuild-governance.md`). Newest entry first. After a context switch: read the latest entry, then the open questions, then the ADRs it names.

## Open questions

- Verify before the manifest change ships (ADR-0002 §4): Chrome keeps a permission moved from `permissions` to `optional_permissions` in the granted set across an update.

## 2026-09-12 — one page session, one permanent-error policy (ADR-0004)

- Branch `rebuild/session`. `src/core/session/index.ts` now owns what `entrypoints/content/index.ts` held (467 → 78 lines, an adapter): modes, prep, highlight, title, the text and image runs, progress, the restart-once guard, the appearance and locale gates, the helper resume. Session identity is the object's own (`active` + one `alive()` per run); `scheduler/session.ts` keeps only `newSessionId()`. `PERMANENT_ERROR_KINDS` / `isPermanentErrorKind` in `providers/types.ts` replace the five hand-written `no-key` / `auth` sets.
- `tests/session/page-session.test.ts` (11 cases) fixes the lifecycle: status waits for the first config read; start marks and mints; refusals and their reasons; restart cancels the old scope; restore strips everything and refuses a stale automatic restart; the permanent hand-over restarts once and a temporary one does not; the watcher gate beats a late read; setMode persists; locale re-applies; bitmaps park until the helper answers and `resumeRaster` releases them once.
- Gate: typecheck, lint, 1 562 unit tests, build 1.25 MB — green. Browser suites: pending below.

## 2026-09-12 — legal registry and stale documents

- Branch `rebuild/docs-hygiene` (stacked on `rebuild/governance`). GPL §5: the 14 ported files carry the English header template; four files whose headers claimed a source without an attribution line got one and a registry row (`scheduler/title.ts`, `scheduler/lazy.ts`, `providers/thinking.ts`, `providers/request/config.ts`); `THIRD_PARTY.md` rewritten in English with the "idea only" files named. Retired: the two executed `docs/superpowers/plans/`, the regenerable `docs/phase0/rules-audit.md` (it committed a local path), the never-adapted `docs/agents/domain.md` and `triage-labels.md`; `issue-tracker.md` rewritten for this repository (only `needs-triage` and `wontfix` exist as labels). RESEARCH.md: frozen-record note, two dated SVG corrections, statuses for the 27-row §7 list.
- Not touched on purpose: `DESIGN.md` and `UI.md` beyond dated corrections (ADR-0001 §3); the v12 spec under `docs/superpowers/specs/` (its decisions exist nowhere else).

## 2026-09-12 — first structural change: the renderer's module graph (ADR-0003)

- Branch `rebuild/renderer-graph` (stacked on `rebuild/governance`, PR #172). `renderer/index.ts` is now a façade of the 29 names production code uses; the implementation moved to `attrs.ts` (names, leaf), `shell.ts`, `translation.ts`, `page.ts`; ten `index ↔ X` cycles are gone, `tests/renderer/module-graph.test.ts` keeps them gone; the translation boundary has one definition (`TRANSLATION_EXCLUDED_CLASSES`) and `tests/renderer/translation-boundary.test.ts` holds the six CSS copies to it; six stray literals became their constants.
- No behaviour change by construction. Gate: typecheck, lint, 1 552 unit tests (1 546 + 6), build 1.25 MB — all green. Browser suites on this build: `e2e` 67/67 (183 s), `layout` 23/23 (78 s) — longest task 203 ms / total 343 ms, prep 214.5 ms per session, 359 mirrors / 418 pairs / 0 misaligned, the same as the baseline within noise.

## 2026-09-12 — baseline and governance

- `main` frozen at 8cfd771 (PR #168 merged), tagged `v0.3.0-mvp`; Phase 1 closed on roadmap #155 with an agent note and the owner's charter posted verbatim.
- Worktree `.worktrees/rebuild` on branch `rebuild/v1`, created from the baseline; `pnpm install` clean.
- Baseline gate on 8cfd771, untouched: `typecheck` 2 s, `lint` 2 s (279 files), `test` 22 s (111 files, 1546 tests, all green), `build` < 1 s warm, bundle 1.25 MB. e2e suites: see `BASELINE.md` when it lands.
- Governance docs written: `CHARTER.md` (English working version of the owner's mandate), ADR-0001, this log, and `CLAUDE.md` rewritten for the rebuild period (English; MVP-era rules that conflict with the charter retired, evidence-based ones kept).
- In flight: four read-only inventories (core pipeline, runtime/providers/cache/helper, UI surfaces, docs audit) to be consolidated into `docs/rebuild/INVENTORY.md`; the behavior baseline (`docs/rebuild/BASELINE.md`) from a full gate run on the untouched baseline.
- Inventory done: four raw agent inventories under `docs/rebuild/inventory/` (1 960 lines, Chinese, verbatim) consolidated into `INVENTORY.md` — 364 guard-ledger rows, external contracts, a deduplicated debt register (duplicated state S1–S12, coexisting paths P1–P9, structure T1–T6, dead code, test gaps, docs), five owner decisions (public Google key vs. hard rule 5, ImageTrans provenance, LICENSE, the `Readarxiv` install dir, `nativeMessaging` permission), twelve open probes.
- Browser suites on the baseline, all green: `e2e` 67/67, `layout` 23/23 (long task max 221 ms, prep 233.5 ms/session), `a11y` 5/5, `local-endpoint` 5/5 — numbers in `BASELINE.md`.
- Owner decisions 2026-09-12 on INVENTORY §5: public Google key → exemption (ADR-0001 §10); install-dir spelling stays (ADR-0001 §6); LICENSE / README are the owner's `docs/readme` branch, the rebuild stays code-side; ImageTrans → agent comparison; `nativeMessaging` → proposal above. Codex CLI updated by the owner.
- ImageTrans provenance settled: independent implementation, compared function by function against the `reference/` snapshot; DESIGN §15.1 carries a dated correction, THIRD_PARTY.md says "ideas only". `nativeMessaging` → optional permission requested on the install gesture, OCR behind one backend interface: ADR-0002 (owner, 2026-09-12).
- Next: fold in the local Codex review; PR into `rebuild/v1`; then the first structural decision as an ADR — the evidence points at the renderer barrel cycles (T1), the content-entry assembly without tests (T2) and the duplicated fatal/cancel/real-translation facts (S3–S5) as the places where a change pays for itself first.
