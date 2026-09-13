#!/usr/bin/env bash
# Developer install (DESIGN §15.4): builds the helper and writes the Native Messaging host manifest into NativeMessagingHosts/ under the
# default user data directories of Chrome and Chromium. Chrome looks in <user data directory>/NativeMessagingHosts/, so a browser started
# with --user-data-dir (Playwright) has to copy the manifest into its own profile; the e2e scripts do that themselves.
# Usage: helper/install.sh <extension-id> [<extension-id>...]
#   The extension id is shown in chrome://extensions (the ID on each extension's card in developer mode). An unpacked extension's id derives
#   from its load path and is stable on one machine; Playwright loading from the same .output/chrome-mv3 path gets the same id.
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <extension-id> [<extension-id>...]" >&2
  exit 2
fi
for id in "$@"; do
  if ! [[ "$id" =~ ^[a-p]{32}$ ]]; then
    echo "Not a valid extension id: $id (expected 32 lowercase letters a–p)" >&2
    exit 2
  fi
done

swift build -c release
BIN="$(pwd)/.build/release/axt-helper"
NAME=io.github.srjoeee.arxivtranslate

origins=""
for id in "$@"; do origins="$origins\"chrome-extension://$id/\","; done
origins="[${origins%,}]"

for dir in "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
           "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"; do
  mkdir -p "$dir"
  cat > "$dir/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "The local OCR helper of arXiv HTML Translator (Vision)",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": $origins
}
EOF
  echo "Written $dir/$NAME.json"
done

echo "helper $("$BIN" --version), binary $BIN"
echo "Image translation is available now; no need to reload the extension."
