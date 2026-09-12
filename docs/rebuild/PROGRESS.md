# Rebuild progress

Checkpoint log for the rebuild toward V1.0 (mandate: `docs/rebuild/CHARTER.md`; governance: `docs/adr/0001-rebuild-governance.md`). Newest entry first. After a context switch: read the latest entry, then the open questions, then the ADRs it names.

## Open questions

- none yet

## 2026-09-12 — baseline and governance

- `main` frozen at 8cfd771 (PR #168 merged), tagged `v0.3.0-mvp`; Phase 1 closed on roadmap #155 with an agent note and the owner's charter posted verbatim.
- Worktree `.worktrees/rebuild` on branch `rebuild/v1`, created from the baseline; `pnpm install` clean.
- Baseline gate on 8cfd771, untouched: `typecheck` 2 s, `lint` 2 s (279 files), `test` 22 s (111 files, 1546 tests, all green), `build` < 1 s warm, bundle 1.25 MB. e2e suites: see `BASELINE.md` when it lands.
- Governance docs written: `CHARTER.md` (English working version of the owner's mandate), ADR-0001, this log, and `CLAUDE.md` rewritten for the rebuild period (English; MVP-era rules that conflict with the charter retired, evidence-based ones kept).
- In flight: four read-only inventories (core pipeline, runtime/providers/cache/helper, UI surfaces, docs audit) to be consolidated into `docs/rebuild/INVENTORY.md`; the behavior baseline (`docs/rebuild/BASELINE.md`) from a full gate run on the untouched baseline.
- Next: consolidate the inventories; rewrite `CLAUDE.md` for the rebuild period; pick the first structural change from the evidence, not from the roadmap's guesses.
