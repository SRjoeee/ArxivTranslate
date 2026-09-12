# Rebuild progress

Checkpoint log for the rebuild toward V1.0 (mandate: `docs/rebuild/CHARTER.md`; governance: `docs/adr/0001-rebuild-governance.md`). Newest entry first. After a context switch: read the latest entry, then the open questions, then the ADRs it names.

## Open questions

- ImageTrans provenance (INVENTORY §5 B): an agent is comparing `renderer/image.ts` / `image/boxes.ts` with the upstream repository — register if derived, correct DESIGN §15.1 if not.
- `nativeMessaging` permission (INVENTORY §5 E): proposal pending the owner — make it optional, request it on the popup's 「安装」 gesture, and let the coming OCR-API path run without it; the helper then has three states (permission not granted / not installed / ready) and image translation no longer implies a native component.

## 2026-09-12 — baseline and governance

- `main` frozen at 8cfd771 (PR #168 merged), tagged `v0.3.0-mvp`; Phase 1 closed on roadmap #155 with an agent note and the owner's charter posted verbatim.
- Worktree `.worktrees/rebuild` on branch `rebuild/v1`, created from the baseline; `pnpm install` clean.
- Baseline gate on 8cfd771, untouched: `typecheck` 2 s, `lint` 2 s (279 files), `test` 22 s (111 files, 1546 tests, all green), `build` < 1 s warm, bundle 1.25 MB. e2e suites: see `BASELINE.md` when it lands.
- Governance docs written: `CHARTER.md` (English working version of the owner's mandate), ADR-0001, this log, and `CLAUDE.md` rewritten for the rebuild period (English; MVP-era rules that conflict with the charter retired, evidence-based ones kept).
- In flight: four read-only inventories (core pipeline, runtime/providers/cache/helper, UI surfaces, docs audit) to be consolidated into `docs/rebuild/INVENTORY.md`; the behavior baseline (`docs/rebuild/BASELINE.md`) from a full gate run on the untouched baseline.
- Inventory done: four raw agent inventories under `docs/rebuild/inventory/` (1 960 lines, Chinese, verbatim) consolidated into `INVENTORY.md` — 364 guard-ledger rows, external contracts, a deduplicated debt register (duplicated state S1–S12, coexisting paths P1–P9, structure T1–T6, dead code, test gaps, docs), five owner decisions (public Google key vs. hard rule 5, ImageTrans provenance, LICENSE, the `Readarxiv` install dir, `nativeMessaging` permission), twelve open probes.
- Browser suites on the baseline, all green: `e2e` 67/67, `layout` 23/23 (long task max 221 ms, prep 233.5 ms/session), `a11y` 5/5, `local-endpoint` 5/5 — numbers in `BASELINE.md`.
- Owner decisions 2026-09-12 on INVENTORY §5: public Google key → exemption (ADR-0001 §10); install-dir spelling stays (ADR-0001 §6); LICENSE / README are the owner's `docs/readme` branch, the rebuild stays code-side; ImageTrans → agent comparison; `nativeMessaging` → proposal above. Codex CLI updated by the owner.
- Next: local Codex adversarial review of this branch; PR into `rebuild/v1`; then the first structural decision as an ADR — the evidence points at the renderer barrel cycles (T1), the content-entry assembly without tests (T2) and the duplicated fatal/cancel/real-translation facts (S3–S5) as the places where a change pays for itself first.
