# UI contract — copy, states, and tokens

The sole authority for UI implementation. The design canvas (`docs/design/canvas/`) is reference material; this document takes precedence in a conflict. Update it before changing the implementation.
Numbering: `P` for popup states, `O` for options, `I` for in-page components; copy IDs use `S-<surface>-<number>`. Cite IDs directly in feedback.

Status: **Draft, under discussion section by section**. Settled sections are marked [Agreed], unresolved sections [Discussion].

---

## 1. Voice rules [Discussion]

1. **Speak to users, not about internals.** Avoid provider, engine chain, degradation, block, session, fallback, background, fixture, and similar terms. Replace internal concepts with the user-facing terms in §2.
2. **Buttons use verb phrases, 3–5 Chinese characters in the original copy specification.** Translate page, Show original, Retry, Connect, Download, Clear. Avoid “Confirm” or “OK”, which do not explain the outcome.
3. **States use nouns or adjectives, 2–4 Chinese characters in the original specification.** Ready, Translating, Paused, Setup required.
4. **Errors say only three things: what happened, its effect, and what the user can do.** No error codes, guessed causes, or apologies. Put error codes and raw messages in hover `title` text for troubleshooting.
5. **Show numbers only when users can act on them.** “2 paragraphs could not be translated · Retry” is useful; “Translated 24 / Triggered 31 (120 total)” is not.
6. **Use one sentence, ≤ 30 Chinese characters in the original specification.** Move longer explanations to options-page help text; do not explain mechanisms in the popup.
7. **No pleasantries or conversational filler**, such as “please” or softening particles. No exclamation marks. Omit a final period for a single sentence; use periods only for two or more sentences.
8. **Use one term for each concept throughout the product**, as specified in §2.
9. **Separate mixed Chinese and English text with one space**; preserve capitalization of product names, model names, and API Key.
10. **The original Chinese copy uses full-width punctuation**; use the single-character ellipsis “…” and separator “·”.

## 2. Terminology [Discussion]

| Internal term (code / DESIGN.md) | User-facing term | Notes |
|---|---|---|
| provider / engine | **Translation service** (shorten to “service” when context is clear) | All three reference products use this term |
| `openai-compat` | **AI model** | Users recognize “AI”, rather than “LLM” or “OpenAI-compatible” |
| `google-web` | **Google Translate** | |
| `chrome-builtin` | **Chrome offline translation** | |
| fallback / demoted | **Switched to ×××** | Describe an action; do not invent a noun |
| block / segment | **Paragraph** | Tables and equation blocks are also “paragraphs” to users |
| translate page | **Translate page** | |
| restore | **Show original** | Pairs with “Translate page”; “Restore” suggests something went wrong |
| mode: stack / side / only | **Stacked / Side by side / Translation only** (short forms in segmented controls: Stacked / Side by side / Translation only) | |
| targetLanguage | **Translate to** | The original alternative phrasing was more literary |
| language pack | **Offline language pack** | |
| prompt | **Prompt** | Familiar to AI users |
| glossary | **Glossary** | |
| cache | **Cached translations** | Do not say just “cache” |
| preload margin | **Translate ahead** | Steps: half a screen / one screen / two screens / three screens |
| preload threshold | **When to start translating** | Steps: first visible / half visible / fully visible |
| thinking | **Deep thinking** | Common terminology in Chinese AI products |
| baseURL | **API endpoint** | |
| apiKey | **API Key** | Keep the English term users see at their service provider |
| model | **Model** | |
| test connection | **Connect** | = save + verify with one sentence |
| retry failed | **Retry** | |
| fatal / stopped | **Paused** | Some translations remain on the page, so use “paused” rather than “failed” |
| image translation / overlay | **Image translation**; do not name the overlay | §15 |
| OCR helper | **Recognition assistant** | Users do not need to know about Native Messaging, Vision, or the helper |
| `image.modes` | **Show image translations in these modes** | Affects display only; does not rerun recognition |
| reading typography (#47) | **Typography** | Separate from decorative “translation styles”: typography controls font size, line height, width, and spacing |
| split view (#83) | **Split view** | Experimental |
| hosted free LLM (#97) | **Free AI translation** | Candidate; alongside “AI model” (bring your own Key) |
| Edge translatetext (#98) | **Microsoft Translator** | Candidate |

## 3. Copy table [Discussion]

### 3.1 Popup

| ID | Location / condition | Copy | Notes |
|---|---|---|---|
| S-P-01 | Brand row | arXiv Translate | Placeholder product name, undecided |
| S-P-02 | Brand-row gear `aria-label` | Settings | |
| S-P-03 | Non-arXiv page / page loading (P0) | Open the HTML version of an arXiv paper to translate it | Same sentence for both cases; do not say “background unresponsive” |
| S-P-10 | Service-row label | Translation service | |
| S-P-11 | Service-row value | {model name / service name} | AI models show the model name (`deepseek-v4-flash`); others show the service name |
| S-P-12 | Status pill · available | Ready | Green |
| S-P-13 | Status pill · translation active | Translating | Red + spinner |
| S-P-14 | Status pill · switched service | Switched | Red; include S-P-30 inside the card |
| S-P-15 | Status pill · preferred service unavailable, fallback available | Will switch | Amber; include S-P-31 inside the card |
| S-P-16 | Status pill · unavailable, no fallback | Setup required | Gray; include S-P-32 inside the card |
| S-P-17 | Status pill · after fatal error | Paused | Gray; include S-P-33 inside the card |
| S-P-18 | Status pill · offline language pack downloading | Downloading | Gray + spinner |
| S-P-20 | Language-row label | Translate to | |
| S-P-21 | Language-row value | {language name} | Label from `languages.ts` |
| S-P-30 | Card note · switched | The API Key for {service name} is no longer valid. Remaining paragraphs will use Google Translate; technical terms may be inaccurate | “Fix” → Settings · Translation service; replace the reason using the S-E table |
| S-P-31 | Card note · will switch | No API Key has been entered; Google Translate will be used this time | “Add key” → Settings |
| S-P-32 | Card note · setup required | Enter an API Key to start translating | “Add key” → Settings; use S-P-40 for the offline-pack case |
| S-P-33 | Card note · paused | {reason}. Update settings, then select “Translate again” | Reason from the S-E table |
| S-P-34 | Card note · settings read failed | Settings could not be loaded; using defaults | Red; “View” → Settings. Highest priority, overriding other notes |
| S-P-35 | Card note · image translation paused | Image translation paused: {reason}. Show the original, update settings, then translate again | `images.fatal`; shown even if text translation is not paused |
| S-P-40 | Service list · offline-translation row action | Download | When downloadable; clicking starts immediately (requires a click gesture) |
| S-P-41 | Service list · offline row subtitle · downloading | Downloading, about 1 minute | No progress events; only an estimate is possible |
| S-P-42 | Service list · offline row subtitle · unsupported language | Offline translation is not yet available for this language | `unavailable` |
| S-P-43 | Service list · offline row subtitle · unsupported Chrome | This Chrome version has no offline translation | `unsupported`; disable the entire row |
| S-P-44 | Service list · AI model subtitle | Most accurate translations | |
| S-P-45 | Service list · Google Translate subtitle | Free, translates in seconds | |
| S-P-46 | Service list · offline subtitle | No internet needed, fastest | |
| S-P-47 | Service list · AI model subrow | Prompt · {name} | Appears only when AI model is selected; opens the prompt list and replaces the existing popup prompt dropdown |
| S-P-48 | Service list · free AI translation (candidate #97) | Free AI translation / Ready to use, no setup | Hidden until integrated |
| S-P-49 | Service list · Microsoft Translator (candidate #98) | Microsoft Translator / Free | Hidden until integrated |
| S-P-50 | Primary button · not translated | Translate page | With shortcut badge |
| S-P-51 | Primary button · translating | Show original | |
| S-P-52 | Primary button · paused | Translate again | Show secondary button S-P-53 alongside it |
| S-P-53 | Secondary button · paused | Show original | Text button |
| S-P-60 | Failure row | {n} paragraphs could not be translated / {m} images could not be translated / {n} paragraphs and {m} images could not be translated | Only when `progress.failed + images.failed > 0` and neither is fatal; choose the applicable form |
| S-P-61 | Failure-row action | Retry | |
| S-P-70 | Mode segments | Stacked · Side by side · Translation only | `title` values S-P-71/72/73 respectively |
| S-P-71 | Mode `title` · stacked | Translation follows directly below the original | |
| S-P-72 | Mode `title` · side by side | Original and translation appear side by side; narrow windows use stacked layout | |
| S-P-73 | Mode `title` · translation only | Hide the original; references remain bilingual | |
| S-P-74 | Note below modes · narrow window | Window is narrow; using stacked layout for now | Only when side by side is selected but the effective layout is stacked |

### 3.2 Options page

| ID | Location | Copy | Notes |
|---|---|---|---|
| S-O-01 | Navigation | Translation service · Reading · Prompts & terms · Data | |
| S-O-02 | Navigation · Prompts & terms `title` for non-AI service | Applies only to AI models | Dimmed but still clickable |
| S-O-10 | Translation-service title / subtitle | Translation service / Choose one; changes take effect immediately | |
| S-O-11 | Translate-to row | Translate to | Shared by all three services |
| S-O-12 | Card · AI model | AI model / Most accurate translations, with paper-aware terminology; requires an API Key | |
| S-O-13 | Card · Google Translate | Google Translate / Free, translates a paper in seconds; technical terms may be inaccurate | “Free” badge |
| S-O-14 | Card · Chrome offline translation | Chrome offline translation / No internet needed, fastest; download a language pack once | “Offline” badge; card actions match S-P-40…43 |
| S-O-15 | Card · free AI translation (candidate #97) | Free AI translation / No setup, provided by arXiv Translate; daily limits apply | Hidden until integrated |
| S-O-16 | Card · Microsoft Translator (candidate #98) | Microsoft Translator / Free; does not preserve link and equation positions | Hidden until integrated; runs path |
| S-O-20 | AI model form | API endpoint · API Key · Model | |
| S-O-21 | API endpoint placeholder | https://openrouter.ai/api/v1 | |
| S-O-22 | API endpoint help | Works with OpenRouter, DeepSeek, and Ollama | Do not announce the permission request; users see the browser prompt when it appears |
| S-O-23 | API Key · saved | •••••••• Saved | “Clear” on the right |
| S-O-24 | API Key help | Optional for local endpoints | Only when the API endpoint is localhost / 127.0.0.1 |
| S-O-25 | Model placeholder | deepseek/deepseek-v4-flash | |
| S-O-26 | Connect button | Connect | Appears only after fields change; click = save + verify |
| S-O-27 | Connection result · success | Connected · {ms} ms | Hover shows the test translation |
| S-O-28 | Connection result · failure | {S-E reason} | Red |
| S-O-29 | More options (collapsible row) | More options | Contains S-O-30 |
| S-O-30 | Deep thinking | Deep thinking / Translation does not need reasoning; enabling it is much slower. Applies only to OpenRouter and DeepSeek | Off by default |
| S-O-31 | Automatic free-service switch | Automatically switch to a free service if something goes wrong / Translation continues if an API Key expires, quota runs out, or the network disconnects | On by default |
| S-O-40 | Reading title / subtitle | Reading / How translations look and when they start | |
| S-O-41 | Translation style | Translation style | Groups: Basic · Underline · Border · Background · Effects · Custom |
| S-O-42 | Style tile names | Match original · Muted · Green · Solid · Dotted · Dashed · Thick dashed · Wavy · Thick wavy · Left rule · Thin border · Dashed border · Highlighter · Gradient highlighter · Highlight background · Tinted background · Gradient text · Multicolor background · Glow · Pulse · Blur | Retain existing names |
| S-O-43 | Style help (below preview, selected styles only) | Blur: hover to reveal, useful for self-testing / Left rule: no rule on short inline headings | No help for the others |
| S-O-44 | Custom CSS help | Declarations only; no selectors or braces. Font family and size follow the paper; do not change them | Only when “Custom” is selected |
| S-O-47 | Typography (#47) | Typography / Original and translation change together; equations and code are unaffected | Card: font size · line height · page width · column gap · paragraph spacing · text color; top presets “Default · Comfortable · Compact”; “Reset to defaults” at upper right; shares the same paragraph preview with translation styles |
| S-O-48 | Split view (#83, experimental) | Side-by-side column divider / Drag the center divider on the page; double-click to recenter | Only a “Recenter” button; development builds only during the experiment |
| S-O-45 | Translate-ahead range | Translate ahead / How far below the screen to translate in advance; a shorter range costs less | Steps: half a screen · one screen · two screens · three screens |
| S-O-46 | Translation trigger | When to start translating / How much of a paragraph must be visible before translation starts | Steps: first visible · half visible · fully visible |
| S-O-50 | Prompts title / subtitle | Prompts & terms / AI models only; controls how they translate | |
| S-O-51 | Prompt list · built-in | Default / Literal translation, preserving paragraph structure · Precision rewrite / Translate, then polish to read like a Chinese academic paper | “View” at row end |
| S-O-52 | Prompt list · custom | {name} / Custom | “Edit” at row end |
| S-O-53 | Create | New prompt… | |
| S-O-54 | Import / export | Import · Export | Export appears only when custom prompts exist |
| S-O-55 | Edit drawer | Edit prompt / Name · System prompt · User prompt / Done · Cancel · Delete | Built-in drawer title: “View prompt”; its only footer action is “Duplicate to edit” |
| S-O-56 | Drawer help | The extension appends the input/output format automatically; it cannot be changed | To the right of the System prompt label |
| S-O-57 | Variable-chip `title` | Target language · Paragraphs to translate (required) · Paper title · Abstract · Current section · Glossary | |
| S-O-58 | Delete confirmation | Delete “{name}”? / Delete · Cancel | `<dialog>` |
| S-O-60 | Glossary | Glossary / One “source, translation” pair per line for consistent terminology within a paper | “{n} entries” at upper right |
| S-O-61 | Glossary error | Line {n}: {reason} | Inline red text, no dialog |
| S-O-80 | Image-translation section | Image translation / Recognize text in images and overlay translations in place; raster images only, not SVG | On the Translation service page below service cards |
| S-O-81 | Recognition assistant · checking | Checking recognition assistant… | Gray + spinner |
| S-O-82 | Recognition assistant · ready | Recognition assistant ready | Green dot; version in `title` |
| S-O-83 | Recognition assistant · missing | Install the recognition assistant (Mac only) | “Installation instructions” → helper/README; disable mode checkboxes below |
| S-O-84 | Recognition assistant · reinstall required | Recognition assistant version mismatch; reinstall it | Handshake lacks version / protocol mismatch |
| S-O-85 | Recognition assistant · non-Mac | Image translation currently supports Mac only | Collapse the section to one line |
| S-O-86 | Recognition assistant · permission missing (after distribution) | Allow communication with the recognition assistant | Button; `permissions.request` requires a click gesture |
| S-O-87 | Image-translation modes | Show image translations in these modes / Affects display only; does not rerun recognition | Checkboxes: Stacked · Side by side · Translation only, all checked by default |
| S-O-70 | Data-page title | Data | |
| S-O-71 | Cached translations | Cached translations / {n} entries · {size} MB · Different services, models, and prompts are stored separately; clearing is usually unnecessary | “Clear” on the right |
| S-O-72 | Read failure | Could not read cached translations | Do not show “0 entries” |
| S-O-73 | Clear confirmation | Clear all cached translations? Future translations will request the service again / Clear · Cancel | |
| S-O-74 | Clear result | Cleared | Disappears after 2 seconds |

### 3.3 In-page components

| ID | Location | Copy | Notes |
|---|---|---|---|
| S-I-01 | Loading | (No text) | Spinner + skeleton lines |
| S-I-02 | Failed block | {S-E reason} · Retry | Raw message in `title` |
| S-I-03 | Service-switch notice (bottom-right of viewport) | Switched to Google Translate · View | Appears once, dismissible, fades after 8 seconds; “View” → Settings · Translation service |
| S-I-04 | Image overlay | (The translation itself) | Translucent white rounded box over original text; hover shows the original; no nodes while pending / failed (§15) |
| S-I-05 | Split-view handle (#83, experimental) | (No text) | Appears on hover over the center gap; drag to resize columns, double-click to reset |

### 3.4 Error reasons (S-E)

`ProviderErrorKind` → user-facing sentence. Used by S-P-30/33, S-O-28, S-I-02.

| kind | User-facing sentence | User action |
|---|---|---|
| `no-key` | No API Key has been entered | Open settings |
| `auth` | API Key is invalid or expired | Open settings |
| `rate-limit` | Too many requests; retrying shortly | None needed |
| `timeout` | Translation timed out | Retry |
| `network` | Network unavailable | Retry |
| `bad-request` | The translation service rejected this request | Hover to see the raw message |
| `invalid-response` | The returned translation has an invalid format | Retry |
| `unknown` | Translation failed | Retry |
| `aborted` | (Not shown) | Canceled by the user |

---

## 4. Popup state table [Discussion]

Columns represent elements; cells show their presentation in each state. “—” means absent. Conditions use code field names.

| ID | State | Condition | Service row | Pill | Language row | Card note | Failure row | Primary button | Secondary button | Mode bar |
|---|---|---|---|---|---|---|---|---|---|---|
| P0 | Non-arXiv / loading | `page === null` | — | — | — | S-P-03 (separate card) | — | — | — | — |
| P1 | Ready | idle ∧ available ∧ !fallback | Value + arrow | Ready | Value + arrow | — | — | Translate page | — | Selectable |
| P2 | Service list expanded | Click service row in P1/P5-/P6 | List (3 rows + language row) | — | Merged into list | — | — | Translate page | — | Selectable (pushed down) |
| P3 | Translating | on ∧ failed = 0 ∧ !demoted | Value, **no arrow** | Translating | Value, **no arrow** | — | — | Show original | — | Selectable |
| P4 | Translating, with failures | on ∧ failed > 0 ∧ !fatal | Same as P3 | Translating | Same as P3 | — | S-P-60 + Retry | Show original | — | Selectable |
| P5 | Switched to another service | `engine.demoted` | New service name, old name struck through | Switched | — | S-P-30 + Fix | Based on failed | Based on on | — | Selectable |
| P6 | Will switch (preferred unavailable, fallback available) | idle ∧ !available ∧ fallback | Preferred name | Will switch | Value + arrow | S-P-31 + Add key | — | Translate page | — | Selectable |
| P7 | Setup required (unavailable, no fallback) | !available ∧ !fallback | Preferred name | Setup required | Value + arrow | S-P-32 / S-P-40 | — | Translate page **disabled** | — | Selectable |
| P8 | Paused | stopped ∧ fatal | Value | Paused | Value | S-P-33 | — | Translate again | Show original | Selectable |
| P9 | Stopped (user showed original) | stopped ∧ !fatal | Value + arrow | Ready | Value + arrow | — | — | Translate page | — | Selectable |
| P10 | Settings read failed | `configFallbackReason()` | Default value | Setup required | Default value | S-P-34 + View | — | Based on available | — | Selectable |
| P11 | Offline language pack downloading | pack = downloading | Value | Downloading | Value | — | — | Translate page disabled | — | Selectable |
| P12 | Image translation paused | `images.fatal` | Follows text state | Follows text state | Follows text state | S-P-35 | Text only | Follows text state | — | Selectable |
| P13 | Image translation active | `images.requested > 0` | Unchanged | Unchanged | — | — | Based on failed | Based on on | — | Selectable |

Composition rules:
- Show only one card note at a time: S-P-34 > S-P-33 > S-P-30 > S-P-31 / S-P-32.
- P5 and P4 can coexist: the failure row still appears below the card.
- During translation (P3–P5), service and language rows are not clickable and arrows disappear; select “Show original” before changing services.
- Narrow-window note S-P-74 is independent of state and depends only on `mode !== preference`.
- Do not repeat why the primary button is disabled; the card note already explains it.
- Image translation has **no separate in-progress indicator** in the popup (P13): overlays appearing on the page provide feedback. Only failures (S-P-60) and pauses (S-P-35) appear. The popup says nothing when the recognition assistant is unavailable; only options explains that.
- Development information (background version, block statistics, raw `fatal` text) appears only in the development-build gallery, never in the production popup.

## 5. Tokens [Discussion]

Define names and two value sets first. Tailwind v4 `@theme` and in-page Shadow DOM share the same CSS variables, prefixed `--axt-`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--axt-bg` | #f5f5f7 | #1c1c1e | Page background |
| `--axt-card` | #ffffff | #2c2c2e | Cards |
| `--axt-fg` | #1e1e24 | #f2f2f7 | Body text |
| `--axt-fg-2` | #7c7c89 | #8e8e93 | Secondary text, labels |
| `--axt-line` | #ececf0 | #3a3a3c | Dividers |
| `--axt-control` | #e9e9ee | #3a3a3c | Segmented-control background |
| `--axt-accent` | #b31b1b | #d63c3c | arXiv red, primary buttons, selected states |
| `--axt-accent-soft` | #fbecec | #3b1f1f | Red pill and failure-row backgrounds |
| `--axt-ok` | #1f8a4c | #30d158 | Ready |
| `--axt-ok-soft` | #e8f5ec | #1f3a29 | Ready-pill background |
| `--axt-warn` | #b8860b | #ffd60a | Will switch |
| `--axt-radius-card` | 14px | | |
| `--axt-radius-control` | 10px | | Segments, inputs |
| `--axt-radius-pill` | 999px | | |
| `--axt-font` | Manrope, PingFang SC, Noto Sans SC, system-ui | | In-page components inherit the paper font instead |

Dark values are a first draft based on Apple system grays; tune them against the real popup during implementation. Whether in-page components follow arXiv’s own dark styles: [To verify].

## 6. Required DESIGN.md changes

- §8.1 Change the default provider to `google-web` (usable on first open)
- §8.4 Language-pack downloads: popup service list + options service card, both triggered by click gestures
- §9 Merge “Test connection” into “Connect”: `setConfig` first, then explicitly ask the current provider to translate one sentence; test the form values
- §9 Configuration writes: every control except the AI model form saves immediately; remove global Save
- §10 Show pretranslation parameters as stepped UI controls, mapped internally to margin / threshold
- §7.6 Add an in-page “Switched” notice (single instance, Shadow DOM)
- Place the error-reason mapping (§3.4) next to `providers/types.ts`
- §15.4 When `nativeMessaging` becomes optional, add options authorization button S-O-86 (decided; implement for distribution)
- #47 Add typography settings to the config schema (new fields, bump version), stored separately from §7.5 translation styles

## 7. Feature coverage checklist

Register each new mainline feature here first; a feature with no UI location is not fully designed.

| Feature | Source | Status | Location | IDs |
|---|---|---|---|---|
| Translate page / Show original | §10 | Implemented | Popup primary button | S-P-50…53, P1–P9 |
| Three comparison modes | §7 | Implemented | Popup mode bar; no in-page control | S-P-70…74 |
| Three translation services + fallback chain | §8 | Implemented | Popup service card / Settings · Translation service | S-P-10…46, S-O-10…31 |
| Offline language-pack download | §8.4 | Implemented | Popup service list + options service card | S-P-40…43 |
| Prompt library (built-in / custom / import-export) | §8.2 | Implemented | Settings · Prompts & terms; popup subrow | S-O-50…58, S-P-47 |
| Glossary | §8.2 | Implemented | Settings · Prompts & terms | S-O-60…61 |
| Translation style presets + custom CSS | §7.5 | Implemented | Settings · Reading | S-O-41…44 |
| Translate-ahead range / timing | §10 | Implemented | Settings · Reading | S-O-45…46 |
| Cache statistics / clearing | §9 | Implemented | Settings · Data | S-O-71…74 |
| Settings-read failure notice | §9 | Implemented | Popup card note | S-P-34, P10 |
| Deep-thinking toggle | §8.2 | Implemented | Settings · More options | S-O-30 |
| Loading spinner / failed-block retry | §7.6 | Implemented | In-page | S-I-01…02 |
| **Image translation**: recognition-assistant detection, mode checkboxes, progress, pause, retry | §15, PR #87–89 | Implemented | Section below Settings · Translation service; popup failure row and card note; in-page overlays | S-O-80…87, S-P-35 / 60, S-I-04, P12–P13 |
| Recognition-assistant authorization button | §15.4 | Decided, for distribution | Settings · Image translation | S-O-86 |
| **Reading typography** (font size / line height / width / spacing / color / presets / reset to defaults) | #47 | Decided, not implemented | Settings · Reading · Typography card | S-O-47 |
| Draggable column divider | #83 | Experimental | In-page handle; one “Recenter” action in settings | S-I-05, S-O-48 |
| Free AI translation (hosted) | #97 | Candidate | Fourth service-list item | S-P-48, S-O-15 |
| Microsoft Translator | #98 | Candidate | Fifth service-list item | S-P-49, S-O-16 |
| In-page “Switched” notice | This proposal | Undecided | In-page | S-I-03 |
| Reading toolbar | Canvas proposal | Undecided | In-page | — |
| Background connectivity / block statistics | Existing popup | Development only | Development-build gallery only | — |

## 8. Open questions

1. Product name. `arXiv Translate` is only a placeholder.
2. “AI model” versus “AI translation”.
3. P8 paused: primary “Translate again” + secondary “Show original”, or a single button?
4. Does the language row open a native `<select>` (type-to-jump) or a searchable list? Test native behavior in the popup first.
5. Whether to add the in-page “Switched” notice; without it, users learn that translation quality changed only by opening the popup.
6. The term “Recognition assistant”.
7. Recheck the typography card’s (#47) field scope and preset names against the issue’s acceptance criteria before implementation.
