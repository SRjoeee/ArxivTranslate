# axt-helper: the local OCR helper for image translation

When the extension translates the text inside bitmaps on a Mac (DESIGN §15), the OCR is done by this small Swift program
with Apple Vision; the translation and the overlay stay in the extension. It talks to the extension through Chrome's
Native Messaging (stdio, length-prefixed JSON); the protocol is in `docs/DESIGN.md` §15.3. The core is ported from
[bytefer/macos-vision-ocr](https://github.com/bytefer/macos-vision-ocr) (MIT).

## One-click install (macOS)

Under “Images” in the popup click “Install”, then paste the command the guide gives you into a terminal and run it; the
command already carries your extension id:

```sh
curl -fsSL https://raw.githubusercontent.com/SRjoeee/ReadarXiv/main/helper/install-remote.sh | bash -s -- <extension id>
```

A second argument names a branch (default main); the command copied from the guide carries the branch it came from.

The script puts the helper's sources under `~/Library/Application Support/Readarxiv/helper`, builds them with the Xcode
Command Line Tools (about a minute the first time; without them, run `xcode-select --install` first) and registers the
Native Messaging host for Chrome / Chromium. **Once it finishes the extension detects the helper by itself: no reload of the
extension, no going back to the guide to confirm** (DESIGN §15.4). No sudo needed.

## Requirements

- macOS 13+, Xcode Command Line Tools (`swift build` has to run; Xcode itself is not needed)
- The extension loaded in Chrome / Chromium (unpacked is fine)

## Install (developer way)

```sh
helper/install.sh <extension-id>
```

The extension id is the “ID” on the extension's card in `chrome://extensions` with developer mode on. The script:

1. runs `swift build -c release`; the binary is `helper/.build/release/axt-helper`
2. writes the host manifest as `NativeMessagingHosts/io.github.srjoeee.arxivtranslate.json` under the default user data
   directories of Chrome and Chromium (`~/Library/Application Support/Google/Chrome/…` and `…/Chromium/…`). Chrome looks in
   **`<user data directory>/NativeMessagingHosts/`**, so a browser started with `--user-data-dir` (Playwright's e2e) has to
   copy the manifest into its own profile directory; the e2e scripts do that themselves

Once installed the extension detects it by itself; the “Images” section of the settings page then shows the helper's
version. Signing, notarisation and pkg distribution are not done yet (§15.4).

## Smoke test

```sh
pnpm helper:build    # swift build -c release
pnpm helper:smoke    # feeds a reference image over the native protocol and checks the recognised lines and coordinates
```

## Uninstall

Delete the two manifest files above; the binary lives in the repository directory and goes with `git clean` or
`rm -rf helper/.build`.
