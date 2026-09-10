# axt-helper：图片翻译的本机 OCR 助手

扩展在 Mac 上翻译位图里的文字时（DESIGN §15），OCR 由这个 Swift 小程序用 Apple Vision 完成；
翻译与叠加层都在扩展里。它通过 Chrome 的 Native Messaging 与扩展通信（stdio、长度前缀 JSON），
协议见 `docs/DESIGN.md` §15.3。核心移植自 [bytefer/macos-vision-ocr](https://github.com/bytefer/macos-vision-ocr)（MIT）。

## 一键安装（macOS）

在 popup 的「图片翻译」下点「复制安装命令」，把命令粘到终端里运行即可；它已经带上了你的扩展 id：

```sh
curl -fsSL https://raw.githubusercontent.com/SRjoeee/ArxivTranslate/main/helper/install-remote.sh | bash -s -- <扩展 id>
```

第二个参数可以指定分支（默认 main），popup 复制的命令会带上它自己所在的分支。

脚本会把 helper 的源码放到 `~/Library/Application Support/Readarxiv/helper`，用 Xcode Command Line Tools 编译（首次约 1 分钟；没装的话先运行 `xcode-select --install`），并注册 Chrome / Chromium 的 Native Messaging host。装完回到 Chrome 重新加载扩展即可。不需要 sudo。

## 要求

- macOS 13+，Xcode Command Line Tools（`swift build` 能跑即可，不需要 Xcode）
- Chrome / Chromium 里已加载本扩展（未打包也行）

## 安装（开发者方式）

```sh
helper/install.sh <extension-id>
```

扩展 id 在 `chrome://extensions` 打开开发者模式后，扩展卡片上的「ID」。脚本会：

1. `swift build -c release`，二进制在 `helper/.build/release/axt-helper`
2. 把 host manifest 写进 Chrome 与 Chromium 默认用户数据目录下的 `NativeMessagingHosts/io.github.srjoeee.arxivtranslate.json`
   （`~/Library/Application Support/Google/Chrome/…` 与 `…/Chromium/…`）。Chrome 找的是 **`<用户数据目录>/NativeMessagingHosts/`**，
   所以用 `--user-data-dir` 起的浏览器（Playwright 的 e2e）要把 manifest 复制进它自己的 profile 目录；e2e 脚本会自己做

装完重载扩展；设置页「图片翻译」一节会显示 helper 版本。签名、公证与 pkg 分发暂不做（§15.4）。

## 冒烟测试

```sh
pnpm helper:build    # swift build -c release
pnpm helper:smoke    # 按原生协议喂一张参考图，检查识别行与坐标
```

## 卸载

删掉上面两个 manifest 文件即可；二进制在仓库目录里，随 `git clean` 或 `rm -rf helper/.build` 走。
