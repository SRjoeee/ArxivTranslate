#!/usr/bin/env bash
# 开发者安装（DESIGN §15.4）：编译 helper，把 Native Messaging 的 host manifest 写进 Chrome 与 Chromium
# 默认用户数据目录下的 NativeMessagingHosts/。Chrome 找的是 <用户数据目录>/NativeMessagingHosts/，
# 用 --user-data-dir 起的浏览器（Playwright）要把 manifest 复制进自己的 profile，e2e 脚本自己做。
# 用法：helper/install.sh <extension-id> [<extension-id>...]
#   扩展 id 在 chrome://extensions 里看（开发者模式下每个扩展卡片上的 ID）。未打包扩展的 id 由加载路径推出，
#   本机稳定；Playwright 从同一路径 .output/chrome-mv3 加载得到同一个 id。
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -lt 1 ]; then
  echo "用法: $0 <extension-id> [<extension-id>...]" >&2
  exit 2
fi
for id in "$@"; do
  if ! [[ "$id" =~ ^[a-p]{32}$ ]]; then
    echo "不是合法的扩展 id：$id（应为 32 个 a–p 的小写字母）" >&2
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
  "description": "arXiv HTML Translator 的本机 OCR 助手（Vision）",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": $origins
}
EOF
  echo "已写入 $dir/$NAME.json"
done

echo "helper $("$BIN" --version)，二进制 $BIN"
echo "重载扩展后，设置页的「图片翻译」一节应显示已检测到 helper。"
