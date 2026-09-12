# ADR-0002: OCR backends and the `nativeMessaging` permission

- Status: accepted (owner, 2026-09-12); implementation scheduled with the image-pipeline rebuild
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
