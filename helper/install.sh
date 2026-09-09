#!/usr/bin/env bash
# Developer installation (DESIGN §15.4): build helper and write its Native Messaging host manifest to Chrome/Chromium
# default user-data directories under NativeMessagingHosts/. Chrome looks in <user-data-dir>/NativeMessagingHosts/;
# browsers launched with --user-data-dir (Playwright) need the manifest in their own profile; e2e scripts handle this.
# Usage: helper/install.sh <extension-id> [<extension-id>...]
# Find extension ids on chrome://extensions cards in developer mode. Unpacked extension ids derive from the load path
# and are stable locally; Playwright loading the same .output/chrome-mv3 path receives the same id.
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <extension-id> [<extension-id>...]" >&2
  exit 2
fi
for id in "$@"; do
  if ! [[ "$id" =~ ^[a-p]{32}$ ]]; then
    echo "Invalid extension id: $id (expected 32 lowercase letters from a–p)" >&2
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
  "description": "Local OCR helper for arXiv HTML Translator (Vision)",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": $origins
}
EOF
  echo "Wrote $dir/$NAME.json"
done

echo "helper $("$BIN" --version), binary $BIN"
echo "Reload the extension; Image translation in Settings should show the detected helper."
