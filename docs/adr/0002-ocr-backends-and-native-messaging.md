# ADR-0002: OCR backends and the `nativeMessaging` permission

- Status: accepted (owner, 2026-09-12); implemented 2026-09-13 (PR #179, see the note at the end)
- Supersedes: DESIGN §15.4's "required permission for now, optional at distribution time"

## Context

Image translation today has exactly one way to read text out of a bitmap: the locally installed `axt-helper`, reached over Native Messaging, which is why `nativeMessaging` is a required permission and why the popup treats "helper not detected" as the first thing a reader must fix. The owner intends to add hosted OCR services, after which a reader can translate images without installing anything. A required permission would then declare a native component that most readers never use, and Chrome's install prompt would name it for everyone.

## Decisions

1. **`nativeMessaging` becomes an optional permission** (`optional_permissions` in `wxt.config.ts`). It is requested with `chrome.permissions.request` on the reader's own gesture — the 「安装识别助手」 action in the popup and on the options page — before the install command is shown. Denial is a normal state with its own copy, not an error.
2. **The image pipeline reads through one `OcrBackend` interface** (`status()`, `ocr(image, scope, signal)`, cancellation by scope) with two implementations: the Native Messaging helper and a hosted API. Which one runs is configuration; `core/image/run.ts` does not know the difference. The Native Messaging protocol v1 (ADR-0001 §6) stays the contract of the helper backend only.
3. **Helper availability has three states, not two**: `permission-missing`, `not-installed`, `ready` (with version). The popup and options page name each; the install waiter (`helper-await.ts`) starts only in the second state.
4. **Existing installs are not disturbed.** Chrome keeps a permission that an update moves from `permissions` to `optional_permissions` in the granted set (verified 2026-09-13, see the note at the end); the only reader today is the owner's own unpacked install.

## Consequences

- The Web Store listing stops naming "communicate with cooperating native applications" for readers who never install the helper.
- `background/helper.ts` gains a `permissions.contains` check ahead of `connectNative`; the "host missing" detection stays as is.
- The image e2e (`tests/e2e/image.mjs`) pre-grants the permission through its patched manifest copy, the way `local-endpoint.mjs` pre-grants a host permission — Playwright cannot click Chrome's permission prompt.
- The hosted OCR backend is its own design (endpoint, key handling under hard rule 5, cost controls under charter §3) and gets its own ADR when it is built; this ADR only fixes the seam it plugs into.

### Verified 2026-09-13 (§4)

A scratch extension on Chrome for Testing 153 (Playwright, persistent profile): v1 declared `permissions: ["nativeMessaging", "storage"]`; the same directory was then replaced by v2 declaring `permissions: ["storage"]`, `optional_permissions: ["nativeMessaging"]`, and the profile relaunched. `chrome.permissions.contains({ permissions: ['nativeMessaging'] })` answered **true** after the update (`getAll` listed both); a fresh profile installing v2 directly answered false. The granted set survives the move from required to optional, so the manifest change ships without an install-time regression for existing users; the unpacked-extension version bump is the closest local stand-in for a store update.

### Implemented 2026-09-13 (PR #179)

- `wxt.config.ts`: `nativeMessaging` under `optional_permissions`; `alarms` added to `permissions` (no install warning) for the restart below.
- **Four states, not three.** `HelperStatus` is a union: `permission-missing`, `restarting`, `not-installed` (with `reason`), `ready` (with `version`). The fourth exists because of a Chrome fact met while implementing: **a permission granted at runtime does not reach a running service worker.** `chrome.runtime.connectNative` is absent from a context created before the grant and is not added afterwards — probe on Chrome for Testing 153: `permissions.remove` in a live worker left the function in place; `extensions/renderer/native_extension_bindings_system.cc` refreshes namespace accessors on a permission change and carries a TODO about objects already instantiated. So the background answers `restarting` when the permission is granted but its own context has no binding, sets a 45 s alarm (past the 30 s idle limit — an alarm landing in the same worker is an event that keeps it alive), and the fresh worker the alarm wakes re-probes and broadcasts `axt:helper-state` to the pages (`background/helper-restart.ts`). `runtime.reload()` was rejected: it closes every extension page and orphans the content scripts of the papers being read.
- **The seam**: `background/ocr-backend.ts` — `OcrBackend { status(options?), ocr(request, scope?), cancel(scope) }` and `OcrBackendError`. No `signal` parameter: cancellation is by scope (ADR-0005), and a backend over `fetch` keeps its scope → controller map behind `cancel`. `createHelperClient` returns an `OcrBackend`; `createOcrService` takes `backend`.
- The request runs in `ui/HelperPermission.tsx` from the 「允许」 click, on both surfaces; denial shows a line and keeps the button. The popup card and the settings section have one face per state (UI.md S-P-86b–d, S-O-86–86b). The install waiter ends on `permission-missing` and pauses on `restarting` (the fresh worker resumes it from storage).
- e2e: `tests/e2e/ext-copy.mjs` copies the build with the permission moved back into `permissions`; `image.mjs` runs on such a copy, `extension.mjs` checks the permission step on the plain build and the guided install on a copy, `local-endpoint.mjs` uses the same helper for its host permission.
- **Not verified by hand**: that Chrome's prompt leaves the popup open (`chrome/browser/ui/views/extensions/extension_popup.cc` keeps the popup while a web-modal dialog is showing — read, not seen), and the 45 s figure against a real grant (Playwright cannot drive the prompt; the test-only auto-confirm switch does not cover `permissions.request`). The alarm path is unit-tested.
