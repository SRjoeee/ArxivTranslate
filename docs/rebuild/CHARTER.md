# Rebuild charter

The owner's mandate for the systematic rebuild toward the next version, stated on 2026-09-12. The Chinese original is preserved verbatim on roadmap issue #155; this is the English working version. Where the two differ, the original governs.

This is not a conservative refactor that keeps every old interface, interaction and implementation intact. The project accumulated substantial technical debt while shipping quickly. The rebuild starts again from the product goals and the overall design, keeps the capabilities that carry real value, removes unnecessary complexity, and produces an implementation that is simpler, more stable, more efficient, and easier to understand, test and maintain.

## 1. Goals and design freedom

- The highest goal is the product's core value and the overall quality of the new version — not a faithful copy of the old implementation.
- Internal interfaces, module boundaries, the state model, data flow, directory layout and implementation approach may all be redesigned. Modules may be selectively rewritten, duplicate entry points merged, interactions unified, low-value configuration reduced, and historical features removed when their maintenance cost clearly exceeds their benefit.
- The new implementation need not be compatible with the old code's internal structure. Do not keep adapter layers, duplicated logic or two sets of state alive in order to preserve old interfaces. Sound old implementation can stay as it is; unsound implementation can be replaced outright. Neither "rewrite everything" nor "change as little as possible" is the presumed right answer.

## 2. Understand deeply before deciding

- Before changing anything, read the actual code, the development conventions, the relevant documents, the tests and the necessary history of fixes, and build an understanding of the complete run path and the key boundaries. Do not read only entry files, infer the design from directory names, or treat plans in documents as implemented features.
- Distinguish genuine domain and platform complexity from complexity caused by poor design, and from historical burden that has lost its value. In particular, understand what each seemingly redundant branch, guard and exception handler originally solved before deciding to keep, rewrite or delete it.
- Old code, old documents and old tests are evidence for extracting requirements, discovering boundaries and preventing regressions — not templates to be copied item by item. When they contradict each other, verify the actual behavior and the product goal; do not mechanically obey any one of them.

## 3. Product simplification and risk boundaries

- Reasonable product simplification may be traded for significant overall gain. Not every historical button, minor interaction or rare setting has to survive.
- Every trade-off must be concrete: what was dropped, which scenarios it affects, which complexity it removed, and whether the benefit has evidence. Do not assume a feature is "unused" without evidence, and do not call an unverified correctness regression a "low-probability compromise".
- Correctness of core content, user data, privacy and security, and resource control must not be quietly weakened for shorter code. Saved configuration, the protocol of separately installed components, and interfaces with real external users need explicit migration or incompatibility handling; they are not ordinary internal functions that can be replaced in lockstep.
- Ordinary technical trade-offs and low-risk, reversible simplifications are made and recorded autonomously, without asking item by item. Only major changes to core product promises, irreversible data loss, or other substantially high-risk decisions require the owner's confirmation — and other work that can proceed safely does not stop while waiting.

## 4. Work independently in the current repository

- Keep the current repository and work on a dedicated rebuild branch: no new repository, no direct changes to `main`. Verify the working tree, branch, commits and existing changes before starting. When a rebuild workspace has been designated, use it; never switch the baseline or overwrite others' work unasked.
- "One module per PR" and "every change must be small" are not hard rules that constrain the design. Organize commits around one complete, explainable, verifiable design change. When a change crosses modules, update the interface and all of its callers together.
- The rebuild may proceed in stages; intermediate steps need not be compatible with the old implementation or carry every old feature immediately. But each checkpoint must be internally consistent, must build, and must verify every path that has been wired in. Do not leave all integration and verification to the end.
- Revise repository conventions and stale documents that conflict with this mandate, so the old architecture and the old workflow stop constraining the work. Keep the necessary security requirements, source attribution and license information. Without an explicit request: no merge into `main`, no version release, no destructive history operations.

## 5. Reduce complexity for real

- Prefer reducing the number of independent concepts, duplicated state, special paths and implicit dependencies, and make responsibilities and resource lifetimes explicit — rather than merely renaming, moving files, splitting functions or adding wrapper layers.
- Do not introduce unnecessary abstractions, frameworks, dependencies or layers for the sake of "clean architecture". Do not refuse to evaluate a better alternative just because the old project fixed a choice. Technical choices rest on real benefit and maintenance cost. Do not expand product scope on your own initiative.
- Temporary transitional code must have a stated purpose and an exit condition. Once a replacement path is complete, remove the superseded implementation, dead interfaces, obsolete tests and stale documents. Two coexisting systems are never the final deliverable.

## 6. Verification throughout

- Establish the necessary behavior baseline first, then keep verifying as the implementation proceeds. Focus on core user tasks, error handling, asynchronous interaction, cancellation and recovery, and the boundaries a change may affect — not only proof that the happy path runs.
- Keep or migrate the tests that protect real behavior and historical defects. Tests that depend on old internals may be rewritten, and acceptance must be updated for behavior deliberately changed or retired. Never delete, skip or weaken a still-valid protection to make a check pass.
- Use the type checks, static analysis, unit tests, integration tests and real-environment verification appropriate to each change. A successful build is not correct behavior, and less code is not better performance. Back performance and stability claims with measurements and experiments wherever possible.

## 7. Execution and delivery

- Keep pushing the actual implementation forward. Do not stop after reading, proposing, scaffolding a directory or converting one sample module. Report important findings, key trade-offs and verification results briefly along the way, and keep the necessary decision and progress records in the repository so that work resumes accurately after a context switch.
- Developer-visible identifiers, comments, documents and test descriptions use clear English. Do not treat localized product copy or multilingual test data as a code-style problem to be replaced. Communication with the owner is in Chinese.
- The main deliverable is code that actually landed, with an account of the substantive improvements made, the behaviors deliberately changed or removed, the verifications run, and what remains unfinished or unverified. Strictly separate implemented, verified and merely inferred conclusions; never claim a check passed that was not run.
- The final standard: can the next maintainer understand the system, locate problems and change it safely with less background knowledge — and can the reader complete the core tasks in a clearer, more reliable way. Success is not measured by the size of the change, the number of files, lines of code, or how much of the old implementation survived.

## Supplement: review and parallelism

- Before opening a PR, run a local Codex review (`/codex:review` or `/codex:adversarial-review`, or the plugin's companion script they wrap) and pass it. Then open the PR for CI and the Codex GitHub review; the existing merge gate (`docs/agents/codex-review.md`) still applies.
- Several agents may work in parallel when that is necessary and suitable, provided the result quality is unaffected.

## How this repository applies the charter

The concrete decisions — baseline, workspace, the status of `docs/DESIGN.md`, which existing hard rules survive, and the external contracts that get migration treatment — are recorded in `docs/adr/0001-rebuild-governance.md`. Progress checkpoints live in `docs/rebuild/PROGRESS.md`.
