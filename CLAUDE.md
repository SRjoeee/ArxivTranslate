# CLAUDE.md — arXiv HTML Translator

A Chrome translation extension for `https://arxiv.org/html/*`: structural preservation, reversible bilingual translation, and comfortable long-form reading.

**Read `docs/DESIGN.md` before starting.** It is the single source of truth. Implementations that conflict with it are incorrect; change the design document before changing the implementation.
`docs/RESEARCH.md` records Phase 0 measurements: corrected selectors, reference-file map, and endpoint availability.

---

## Fixed technology stack

| Purpose | Choice |
|---|---|
| Extension framework | WXT + TypeScript, pnpm |
| UI | React; injected overlays use WXT `createShadowRootUi` for Shadow DOM isolation; popup / options are standalone extension pages and need no isolation |
| LLM calls | Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible` for OpenRouter / DeepSeek / Ollama, `@ai-sdk/anthropic`, `@ai-sdk/google`); structured output uses `generateText` + `Output.object` + zod (AI SDK 7 replaces `generateObject`). Let the SDK handle request construction, streaming, and error classification; do not maintain custom API clients |
| Validation | zod |
| Queue / retry | Port Read Frog `utils/request/`: `request-queue` token bucket, `batch-queue` batching, `retry-policy`; see DESIGN.md §8.2 |
| Cache | Dexie (IndexedDB), port FluentRead's cache implementation |
| Configuration | WXT storage with schema versions and migrations |
| Hashing | Web Crypto SHA-256 |
| Chrome Translator types | `@types/dom-chromium-ai` |
| Tests | Vitest + happy-dom |
| Lint | Biome linter only, formatter disabled. Do not reflow long lines or ported files. Use biome.json overrides for ported directories such as `src/providers/request/**`; do not rewrite upstream code merely for lint |

Do not implement request queues, retry backoff, hashing, storage wrappers, or tolerant JSON parsing from scratch. Use the libraries above or mature reference implementations, such as Read Frog `utils/request/*` and FluentRead `services/translation/cache.ts` (including its Dexie dependency).

---

## Directory structure

```
src/
  entrypoints/
    content.ts          # Inject into arxiv.org/html/*
    background.ts       # Queues, providers, cache
    popup/              # React
    options/            # React
  core/
    rules/latexml.ts    # All ltx_* selectors; exports RULES_VERSION
    extractor/          # Block extraction
    protector/          # Placeholders: serialize, validate, rehydrate, split runs
    renderer/           # Sibling insertion, mode switching, restoration
    scheduler/          # One-shot viewport observer, session IDs, title translation, main-thread slicing
  providers/
    types.ts            # TranslationProvider interface (DESIGN.md §8)
    openai-compat.ts  anthropic.ts  gemini.ts  chrome-builtin.ts  google-gtx.ts
    prompt.ts           # LLM prompt; exports PROMPT_VERSION
  cache/
  config/
  styles/
    modes.css           # side / stack / only
    presets.css         # Translation style presets
docs/
  DESIGN.md  RESEARCH.md
tests/
  fixtures/arxiv/<arxiv-id>.html
reference/              # Reference repositories, ignored by Git, read-only
```

---

## Hard rules

1. **DOM invariants** (DESIGN.md §7.1): insert translations only as the original block's next sibling. Original nodes may receive only `data-axt-*` attributes; never modify their subtrees. Global state belongs only on `<html>`. Restoration must reproduce the pretranslation DOM node-for-node. Tests guard this; never bypass them.
2. **Centralized selectors**: all `ltx_*` selectors belong in `src/core/rules/latexml.ts`; other TS files access them through the rules module. The sole exception is `src/styles/*.css`: layout must remain declarative, without runtime node markers coupling CSS to JS lifecycle. Stylesheet `ltx_*` selectors serve layout only; the rules module remains the authority on what to translate.
3. **Two rendering paths**: provider `preservesMarkup` selects markup or runs. Do not special-case providers in rendering.
4. **Treat free endpoints as unstable**: `chrome-builtin` and `google-gtx` have separate files and error types. Failures must be recoverable and trigger fallback, never disable the whole extension.
5. **Prefixes**: injected classes / data attributes / CSS variables start with `axt-` / `data-axt-` / `--axt-`.
6. **Cache keys** must include `providerId | model | PROMPT_VERSION | RULES_VERSION | target | renderPath | normalizedText`. Increment versions when prompt or rule behavior changes.
7. **Secrets**: API keys belong only in WXT storage, never logs, cache keys, test fixtures, or Git.

---

## Reference-code boundaries

`reference/` contains KISS Translator, Read Frog, and FluentRead source (GPL-3.0, the same license as this project). It is **read-only**.

- **Prefer porting by default**: reuse mature request construction, queues / retries / batching, caching, config migration, placeholder validation, viewport scheduling, presets, and UI components. Adapt names and paths to this project without importing upstream configuration systems. See `docs/RESEARCH.md` §4 for the file map. **Decide based on negative impact**: retain currently unused code with no extra burden when porting a module (whole directories, not selected functions), then clean up after stabilization. Discuss only parts that harm performance or quality and record the rationale in DESIGN.md.
- **Original implementations have only three exceptions**: (1) arXiv adaptation: `rules/latexml.ts`, LaTeXML extraction, and the placeholder engine (Phases 1 / 2 complete, DESIGN.md §6); (2) renderer: all three references modify, wrap, or replace original nodes, violating §7.1; (3) a port would violate design invariants or make code harder to maintain. Explain rewrites in the PR.
- **Attribution (GPL §5)**: each ported file needs a header: `// Ported from reference/<repo>/<path>@<commit> (GPL-3.0), <YYYY-MM-DD>; modified.` GPL §5(a) requires a dated modification notice. Register it in `docs/THIRD_PARTY.md`, including substantial rewrites. Preserve the actual upstream license, copyright, version, and modification history.
- Future direction: organize extraction around a site-adapter interface, with LaTeXML first. Port Read Frog `dom/filter.ts` / `dom/traversal.ts` as a second, generic heuristic adapter for other paper sites in v2; v1 remains arXiv-only.

---

## Workflow

- For modules exceeding 100 lines, first present a plan in plan mode, citing the relevant DESIGN.md sections.
- One module per branch / PR. Changes to rules, protector, or renderer require tests.
- Before finishing, pass `pnpm typecheck && pnpm check:language && pnpm lint && pnpm test && pnpm build`.
- **After opening a PR or pushing, wait for Codex review before merging**: 👀 means in progress. Wait for one terminal signal: 👍 (no suggestions), a review with inline comments, or a rate-limit notice. Verify each comment using fixtures, measurements, or code before accepting it; explain rejected suggestions. See `docs/agents/codex-review.md`.
- For DESIGN.md items marked **[To verify]**, first measure with fixtures or curl and record results in `docs/RESEARCH.md`, then implement.
- If measurements contradict DESIGN.md, stop, record the discrepancy in RESEARCH.md, and propose a revision. Never silently change the design.
- Use English identifiers and commit messages in `type(scope): summary` format. Follow the engineering-language policy below for all project-authored text.

### Engineering language

Use accurate, natural, concise English for project-authored documentation, comments, test names and explanations, logs, errors, CLI help, configuration guidance, and UI copy / accessibility text. Extension-owned HTML pages use English language metadata. This supersedes the former Chinese-comment and Chinese-documentation rule; all unrelated constraints remain in force.

- Preserve technical meaning, mandatory constraints, rationale, uncertainty, measurements, and attribution. Do not rewrite already clear English.
- Preserve translation inputs / expected outputs, real paper fixtures, multilingual / Unicode cases, native language names, user prompt / glossary data, and required third-party text when their original form matters. Engineering comments and test names are not data exceptions.
- Register retained Han text or CJK punctuation in `scripts/language-exceptions.json` with an exact file, exact line content, occurrence count, and specific reason. No directory exemptions, automatic allowlisting, Unicode escaping, transliteration, deleted data, or weaker tests to pass the check. Remove stale entries when their data changes.
- `pnpm check:language` scans tracked text and validates those exact exceptions; CI runs it. It detects likely regressions, not English quality or semantic correctness. Review wording, mixed-language fragments, punctuation, links / anchors, and length-sensitive UI manually too.
- English UI does not change the translation target. Keep saved settings, language codes, storage / cache keys, message types, selectors, public interfaces, and multilingual behavior compatible.
- Actual model prompts affect behavior. Keep existing English prompts unchanged. Translate Chinese instructions only with their protocols, placeholders, boundaries, and version / cache rules intact. Comment or UI translations alone must not bump prompt / rule versions or invalidate caches.
- Update text-dependent locators, regexes (including negative matches), reports, and assertions together, preserving their strength. Check longer English text for clipping, wrapping, and accessibility. Never change the host paper's language metadata to match extension UI.

---

## Phase 0 tasks

Complete in order; record all outputs in `docs/RESEARCH.md`.

1. **Fetch 8–10 HTML fixtures** into `tests/fixtures/arxiv/`, covering dense inline math (mathematics / theoretical CS), algorithm / code blocks, large / numeric tables, footnotes / theorems, at least two papers each from 2023 (early LaTeXML) and 2026, and at least one `.ltx_ERROR`.
2. **Audit rule coverage**: list every text-bearing element with its `ltx_*` classes and counts. Match DESIGN.md §5 translation / skip rules and report (a) rule classes absent from all fixtures, (b) uncovered text-bearing elements, and (c) classes found only in some years. Goal: every text node matches exactly one rule. Also count SVG figures (§15.1).
3. **Containers and navigation**: verify main containers (expected `.ltx_page_main` / `.ltx_page_content`), left `.ltx_page_navbar`, and arXiv-injected headers / footers. Record page JS behavior: footnote popups, navigation toggles, MathJax fallback.
4. **Reference map**: clone the three references into `reference/`. Map each DESIGN.md §4 module to `<repo>/<path>`, especially Read Frog DOM walking / only-mode markers, KISS rich-text translation / Google adapter, and FluentRead progressive translation / caching.
5. **Endpoint availability**: use curl to test current availability, response format, and HTML-tag preservation for Google `translate.googleapis.com/translate_a/single?client=gtx`, Microsoft `edge.microsoft.com/translate/translatetext` (record only; not v1), and Google `translateHtml` (find usage in references).
6. **Translator API**: use a minimal content script to test `'Translator' in self`, `Translator.availability()`, whether `create()` needs a user gesture, and model-download behavior.
7. Finally, list proposed DESIGN.md revisions without changing DESIGN.md directly.

---

## Common commands

```
pnpm install
pnpm dev            # WXT development mode; load automatically in Chrome
pnpm build
pnpm test
pnpm test:watch
pnpm typecheck
pnpm check:language # Tracked engineering text and exact data exceptions
pnpm lint           # Biome linter; pnpm lint:fix applies safe fixes
pnpm e2e            # Playwright Chromium with extension; build first, install Chromium on first use
pnpm e2e:layout     # Side layout: width contract, marker slots, flex figures, margin notes
pnpm e2e:a11y       # A/B axe audit; report extension-introduced differences only (§7.4b)
pnpm e2e:local-endpoint # Full-page translation through a local HTTP endpoint without CORS headers (issue #42)
pnpm fixtures:stats # Phase 0 class histogram script (to be created)
```

---

## Agent skills

### Issue tracker

Issues and specs live in this repository's GitHub Issues; access via `gh`. See `docs/agents/issue-tracker.md`.

### Codex review

Wait for a terminal signal before merging (👍 / inline comments / rate-limit notice; 👀 means still reviewing). Verify comments individually. See `docs/agents/codex-review.md`.

### Triage labels

Use the five standard labels: `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`. Labels match role names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
