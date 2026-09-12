# CLAUDE.md — Read arXiv

Chrome extension (MV3) that translates `https://arxiv.org/html/*` in place: structure-preserving, reversible, made for long bilingual reading sessions. Display name **Read arXiv**; repository `ReadarXiv`; everything the extension injects is prefixed `axt-` / `data-axt-` / `--axt-`.

## Where the truth lives

The project is being rebuilt toward V1.0 under the owner's mandate of 2026-09-12. Read in this order:

1. `docs/rebuild/CHARTER.md` — the mandate: goals, freedoms, risk boundaries, how work is organized. It overrides habits recorded anywhere else.
2. `docs/adr/` — one decision per file. ADR-0001 is the governance: baseline, workspace, which MVP conventions survive, which contracts get migrations.
3. `docs/rebuild/PROGRESS.md` — the checkpoint log. After a context switch, start there.
4. `docs/rebuild/INVENTORY.md` and `docs/rebuild/BASELINE.md` — what the MVP code actually does (module map, run paths, the guard ledger: what each odd branch originally fixed and which test guards it) and what its suites and measurements protect. The evidence for every trade-off.
5. `docs/DESIGN.md` — **frozen** record of the v0.1 implementation (tag `v0.3.0-mvp`), with `docs/RESEARCH.md` (Phase 0 measurements) and `docs/UI.md` (the MVP UI contract). Cite them as evidence, not as the spec; edit them only to correct a misleading factual error, with a dated note.

`main` is frozen at the MVP baseline. Rebuild work happens on `rebuild/v1` (worktree `.worktrees/rebuild`). Without the owner's explicit request: nothing merges into `main`, no version is released, no history is rewritten.

## Hard rules

Each is a product promise, a legal requirement, or a contract with something outside this repository. They survive the rebuild unchanged.

1. **DOM invariants** (DESIGN §7.1, guarded by tests): a translation node is inserted only as the next sibling of its original block; an original node gains `data-axt-*` attributes and nothing else; global state lives only on `<html>`; after restore the DOM equals the pre-translation DOM node by node.
2. **Prefixes**: every injected class, data attribute and CSS variable starts with `axt-` / `data-axt-` / `--axt-`.
3. **Free and built-in translation APIs are unreliable by assumption**: their failure must be recoverable and must trigger the fallback chain; it must never take the extension down.
4. **Cache key** carries every input that changes a translation — today `CACHE_KEY_VERSION | providerId | model | PROMPT_VERSION | promptKey | context | RULES_VERSION | target | renderPath | normalizedText | cuts` (`src/cache/key.ts`); bump the matching version whenever a prompt, a rule or the request shape changes meaning.
5. **Secrets**: API keys live only in WXT storage — never in logs, cache keys, fixtures or git. A third party's public client constant (the Google web translator's key in `providers/google-web.ts`) is not a secret — ADR-0001 §10.
6. **Attribution**: code ported from `reference/` (KISS Translator, Read Frog, FluentRead — GPL-3.0, read-only, git-ignored) keeps the header `// Ported from reference/<repo>/<path>@<commit> (GPL-3.0), <YYYY-MM-DD>, modified` and an entry in `docs/THIRD_PARTY.md`.
7. **External contracts** (ADR-0001 §6) get migration or compatibility handling, never silent replacement: the saved configuration schema, the Native Messaging protocol with the installed `axt-helper`, the installer surface.

Two MVP design rules stay as defaults, open to re-evaluation with evidence: `ltx_*` selectors live only in `src/core/rules/latexml.ts` (style sheets may use them for layout only); the wire format (tags / markers / runs) is negotiated from the provider's declared `wireFormats`, never chosen by provider identity in the renderer.

## Stack

WXT + React + TypeScript with pnpm · Vercel AI SDK for LLM providers (structured output via `generateText` + `Output.object` + zod) · Dexie for the translation cache · WXT storage with schema versions and migrations · Vitest + happy-dom for unit tests, Playwright for e2e · Biome, linter only · Swift for the macOS image-recognition helper. Target is Chrome MV3 (`minimum_chrome_version` in `wxt.config.ts`); no cross-browser branches or polyfills; runtime feature detection stays because a free API can be absent on the same Chrome.

This is the current stack, not a fixed one: a change is allowed with evidence of real benefit and an ADR (charter §5).

## Working rules

- **A PR is one complete, explainable, verifiable design change.** Cross-module changes update the interface and every caller together. Keep unrelated changes out; never split a coherent change to make it small. The MVP-era measurement (ADR-0001 §8) shows large PRs cost five to six Codex rounds — the local review before opening is how that cost is paid down.
- **Gate before every PR** — the same four steps CI runs: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus the e2e scripts relevant to the change. `pnpm test` is vitest and does not type-check (#115 went red in CI after a green local run for exactly this reason).
- **Self-review before asking for review.** On 2026-09-08 about a quarter of the review rounds went to "fixing A broke B": after adding a constraint, grep for everyone else on that path; read your own diff as someone else's code and ask what used to work and now does not.
- **Local Codex review, then the PR.** Run `/codex:adversarial-review` (or `/codex:review`; both wrap `node <codex plugin>/scripts/codex-companion.mjs … --base rebuild/v1 --scope branch`) and pass it before opening the PR. Then wait for CI and the Codex GitHub review's terminal signal — 👍, review comments, or a usage-limit notice; 👀 means still reviewing. Verify every comment against a fixture, a probe or the code before adopting it; write down what you declined and why. One review request per fix batch, not per commit. Details: `docs/agents/codex-review.md`.
- **Do not wait on review to start the next independent PR.** Disjoint files are necessary but not sufficient for independence: a branch that consumes a type, a schema value or a behaviour a pending PR introduces depends on it — branch from the pending branch or wait. Two branches editing the same file is the case to avoid outright.
- **Parallel agents for measurement and reading, not for implementation.** Probes, inventories and multi-angle reviews are independent and self-verifying; run them concurrently and re-check their conclusions here. Implementation correctness comes from holding the whole context; cross-module interface changes are single-threaded.
- **Verify before relying.** A claim in a frozen document or an old comment is a hypothesis: check it with a fixture, a probe or `git log -S` before building on it, and record what you found in the ADR that depends on it.
- **Ported code.** The MVP's "port the whole directory, clean up later" policy is over (ADR-0001 §9). Keep only what is called; when a ported module is touched, its unused parts go.

## Language

Everything written for developers is English: identifiers, comments, docs, test names and assertion messages, commit messages (`type(scope): summary`), PR descriptions, issues. Convert existing Chinese where a change touches it — the passage and its surroundings, never a whole file for one line (an 800-line translation diff is unreviewable and breaks `git blame`; Codex on #120).

Three kinds of Chinese are product, not prose, and stay:

1. **Product copy** — the extension speaks Chinese to its readers; popup and options strings are the product.
2. **Localization data** — `LANG_CODE_TO_ZH_NAME` / `LANG_CODE_TO_LOCALE_NAME` feed the language labels shown in settings.
3. **Multilingual test inputs and expectations** — `weights -> 权重` in the prompt tests and `证明。` in the rules tests are the non-Latin coverage itself; translating them silently deletes it.

Conversation with the owner is in Chinese.

## Commands

```
pnpm install
pnpm dev                 # WXT dev mode, loads into Chrome
pnpm typecheck           # tsc --noEmit — vitest does not type-check
pnpm lint                # Biome linter; pnpm lint:fix applies safe fixes
pnpm test                # vitest; pnpm test:watch
pnpm build               # wxt build + scripts/check-output.mjs (rejects non-characters Chrome refuses to load)
pnpm e2e                 # real Chromium with the extension (pnpm build first; once: npx playwright install chromium)
pnpm e2e:layout          # side-mode layout contract in a real browser
pnpm e2e:a11y            # A/B axe audit: only differences the extension introduces
pnpm e2e:local-endpoint  # an http endpoint without CORS headers can translate a whole page (#42)
pnpm e2e:image           # image translation through the installed helper (SKIP without it)
pnpm e2e:placeholders    # placeholder survival per sentence shape against a live engine (DESIGN §6.3)
pnpm fixtures:stats      # rule coverage audit over the fixtures
pnpm helper:build        # Swift helper; pnpm helper:smoke talks to the binary over Native Messaging frames
```

## Agent skills

### Issue tracker

Issues, the roadmap (#155) and the rebuild's open items live in this repository's GitHub Issues, read and written through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Codex review

Merge only after Codex's terminal signal (👍 / review comments / usage-limit notice; 👀 means still reviewing); verify every comment. See `docs/agents/codex-review.md`.
