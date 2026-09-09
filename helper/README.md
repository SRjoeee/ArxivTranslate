# axt-helper: local OCR for image translation

When the extension translates bitmap text on Mac (DESIGN §15), this Swift helper performs OCR with Apple Vision.
Translation and overlays stay in the extension. Communication uses Chrome Native Messaging (stdio with length-prefixed JSON);
see `docs/DESIGN.md` §15.3. Core code is ported from [bytefer/macos-vision-ocr](https://github.com/bytefer/macos-vision-ocr) (MIT).

## Requirements

- macOS 13+ and Xcode Command Line Tools (`swift build` must work; full Xcode is not required)
- The extension loaded in Chrome / Chromium (unpacked is supported)

## Developer installation

```sh
helper/install.sh <extension-id>
```

Find the extension ID on its card in `chrome://extensions` with developer mode enabled. The script:

1. Runs `swift build -c release`, producing `helper/.build/release/axt-helper`.
2. Writes the host manifest to `NativeMessagingHosts/io.github.srjoeee.arxivtranslate.json` under the default Chrome and Chromium user-data directories
      (`~/Library/Application Support/Google/Chrome/…` and `…/Chromium/…`). Chrome looks in **`<user-data-dir>/NativeMessagingHosts/`**,
      so browsers launched with `--user-data-dir` (Playwright e2e) need the manifest copied into their own profile. The e2e scripts do this automatically.

Reload the extension after installation. The Image translation section in Settings should show the helper version. Signing, notarization and pkg distribution are deferred (§15.4).

## Smoke test

```sh
pnpm helper:build    # swift build -c release
pnpm helper:smoke    # Send a reference image through the native protocol; check recognized lines and coordinates.
```

## Uninstall

Delete the two manifest files above. The binary stays in the repository and can be removed with `git clean` or `rm -rf helper/.build`.
