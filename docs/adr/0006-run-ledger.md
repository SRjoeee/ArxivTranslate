# ADR-0006: One ledger for the text and image runs

- Status: proposed (2026-09-13); fourth structural change of the rebuild
- Evidence: `docs/rebuild/INVENTORY.md` P1; `inventory/core.md` §4.1; `src/core/pipeline/run.ts` (358 lines) and `src/core/image/run.ts` (425 lines) read side by side

## Context

The text run and the image run are two state machines of the same shape, written twice. Each keeps `outcome: Map<target, 'waiting' | 'requested' | 'done' | 'failed'>`, counts `requested` / `done` / `failed` out of it for its progress, reports through a `report()` that is gated by `stopped`, records a permanent error the same way (`isPermanentErrorKind` → `fatal = "kind: message"`, scheduler disconnected), answers "am I still allowed to work" (`halted()` in one, `alive()` in the other, the latter also asking the session), takes work through the same skeleton (filter the targets that are known and not yet requested, claim them from the lazy scheduler, mark them requested, report, process, report), creates the lazy scheduler the same way, and lists its failures with the same filter. Forty-seven unit tests pin them separately, and the session reads two progress shapes.

What differs is real and stays where it is: the text run renders (pending → text / table / failed widgets), batches (`planBatches`), splits a failed batch on isolatable errors, retries a single segment and falls back to runs, counts cache hits and reports engine hand-overs; the image run parks targets behind a per-target gate (`isEnabled`, `resume`) and runs fetch → hash → OCR through a content-side worker pool. Bitmaps are not `Block`s (INVENTORY P1 calls the split deliberate); the ledger is generic over the target.

## Decisions

1. **`src/core/run/ledger.ts` — `createRunLedger(targets, deps)`** owns what both runs kept: the outcome of every target and its failure reason, the permanent-error record, the stopped flag, the lazy scheduler (created by `observe()`, since the text run may only start observing after its sliced marking), and the questions asked of them — `halted()`, `progress()`, `failed()`, `inState()`. Work enters through `intake(picked, admit?)`: the targets that are known, not yet requested and admitted are claimed from the scheduler and returned as `taken`, the rest as `held` (the image run parks them); `request()` marks targets requested, `settle()` records done or failed with a reason.
2. **Policy stays in the runs.** A permanent error makes the text run stop taking new batches while the ones in flight finish; it makes the image run fail every requested target at once and drain its pool. The ledger records the error once and disconnects the scheduler; each run keeps its own consequence (`onFatal`) and its own clean-up on stop (`onStop`). No behaviour changes by construction: the forty-seven run tests stay as they are, the e2e suites are the acceptance.
3. **The wire shapes are unchanged.** `Progress` (text: adds `state`, `inFlight`, `cached`) and `ImageProgress` are what the popup and `axt:page-status` see; both are built from the ledger's `RunProgress` counts.
4. **Reporting stays in the runs** — two lines each — because the text run's shape is its own; what the ledger removes is the state machine, not the callback.

## Consequences

- One place answers "which targets are still to do, which failed, why, and whether the run may go on" for both pipelines; a third pipeline (tables as their own run, or SVG figures separated from bitmaps) would start from it.
- `core/session` keeps reading two progress fields (a contract), and its two idle traces keep their busy → idle detection; folding those into one helper is a follow-up, not this change.
- The known `e2e:image` flake (`images idle: N/N of 6`, targets never requested) lives in the image run's scheduling and parking; the ledger makes that path shorter to read but this ADR does not claim to fix it.
