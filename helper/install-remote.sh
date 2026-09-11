#!/usr/bin/env bash
# One-line install of the recognition helper (macOS), the command the popup copies:
#   curl -fsSL https://raw.githubusercontent.com/SRjoeee/ArxivTranslate/<ref>/helper/install-remote.sh | bash -s -- <extension-id> [<ref>]
# <ref> is the branch the sources come from (default main; the popup passes the one it was built from).
# Downloads this repository's helper/ into ~/Library/Application Support/Readarxiv/helper, builds it
# with the Swift toolchain of the Xcode Command Line Tools, and registers the Native Messaging host
# for Chrome and Chromium (DESIGN §15.4). Re-running updates in place. No sudo, nothing outside
# that directory and the two NativeMessagingHosts folders.
set -euo pipefail

REPO=SRjoeee/ArxivTranslate
REF="${2:-${AXT_HELPER_REF:-main}}"
NAME=io.github.srjoeee.arxivtranslate
DIR="$HOME/Library/Application Support/Readarxiv/helper"

id="${1:-}"
if [ -z "$id" ]; then
  echo "用法：curl -fsSL https://raw.githubusercontent.com/$REPO/$REF/helper/install-remote.sh | bash -s -- <扩展 id> [分支]" >&2
  echo "扩展 id：popup 里「复制安装命令」已经带上；或在 chrome://extensions 打开开发者模式后查看。" >&2
  exit 2
fi
if ! [[ "$id" =~ ^[a-p]{32}$ ]]; then
  echo "不是合法的扩展 id：$id（应为 32 个 a–p 的小写字母）" >&2
  exit 2
fi
if [ "$(uname -s)" != "Darwin" ]; then
  echo "识别助手目前仅支持 macOS。" >&2
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo "需要 Xcode Command Line Tools。请先运行：xcode-select --install，装好后再执行这条命令。" >&2
  exit 1
fi

echo "下载 helper 源码到 $DIR …"
mkdir -p "$DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF" -o "$tmp/src.tgz"
tar -xzf "$tmp/src.tgz" -C "$tmp"
src="$(find "$tmp" -maxdepth 1 -type d -name 'ArxivTranslate-*' | head -1)"
rm -rf "$DIR/Sources" "$DIR/Tests"
cp -R "$src/helper/Sources" "$src/helper/Package.swift" "$src/helper/LICENSE-macos-vision-ocr.txt" "$DIR/"
[ -d "$src/helper/Tests" ] && cp -R "$src/helper/Tests" "$DIR/"

echo "编译（首次约 1 分钟）…"
(cd "$DIR" && swift build -c release >/dev/null)
BIN="$DIR/.build/release/axt-helper"

for dir in "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
           "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"; do
  mkdir -p "$dir"
  manifest="$dir/$NAME.json"
  # Keep the ids an earlier run allowed (another profile, a dev build): union, not overwrite
  origins="\"chrome-extension://$id/\""
  if [ -f "$manifest" ]; then
    while read -r existing; do
      [ -n "$existing" ] && [ "$existing" != "chrome-extension://$id/" ] && origins="$origins, \"$existing\""
    done < <(grep -o 'chrome-extension://[a-p]\{32\}/' "$manifest" | sort -u)
  fi
  cat > "$manifest" <<JSON
{
  "name": "$NAME",
  "description": "Readarxiv 的图片识别助手（Apple Vision）",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": [$origins]
}
JSON
done

echo "已安装：$("$BIN" --version)"
echo "图片翻译现已可用，无需重新加载扩展。"
