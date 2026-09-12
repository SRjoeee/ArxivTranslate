import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

// WXT 工程配置。host_permissions 等到 Phase 3 接网络引擎时再加。
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // 扩展页面里 <link rel="modulepreload" crossorigin> 会触发 Chrome 的 "cross-world extension resource mismatch" 告警（无害但刷屏），关掉预加载
  vite: () => ({ build: { modulePreload: false }, plugins: [tailwindcss()] }),
  // The gallery is for `wxt` (serve) only: a release must not ship a debug page anyone can open
  hooks: {
    'entrypoints:found': (wxt, infos) => {
      if (wxt.config.command !== 'serve') {
        const at = infos.findIndex(info => info.name === 'gallery')
        if (at >= 0) infos.splice(at, 1)
      }
    },
  },
  manifest: {
    // UI.md S-P-01 requires the store listing, the manifest and the site to carry one name
    name: 'Read arXiv',
    // Two marks, two surfaces (scripts/icons.mjs): `icons` is filled by WXT from public/icon/<size>.png,
    // the tile, for the card the extensions page and the store put an icon on. Everywhere the mark
    // stands on its own — this toolbar button, the page tabs, our own brand rows — it is the bare
    // book, whose outline keeps it legible on a light and a dark surface alike
    action: {
      default_icon: { 16: 'icon/mark-16.png', 32: 'icon/mark-32.png', 48: 'icon/mark-48.png' },
    },
    // 图片叠加层用 CSS 锚点定位，`anchor-scope` 要 Chrome 131（§15.2）。文档一直这么写，但没落到
    // manifest 上，低于这个版本的 Chrome 照样装得上、拿到一个错位的叠加层，而且滚动容器也不进
    // 顺序焦点（Codex 在 #99 指出）。声明出来，让文档写的下限真正生效
    minimum_chrome_version: '131',
    // The two strings Chrome itself shows — the extensions page, the store listing and the shortcuts
    // page — come from public/_locales, because only the browser reads them and only it can pick a
    // language for them. Everything inside our own pages follows the reader's own choice instead
    // (src/locales, UI.md §7)
    default_locale: 'en',
    description: '__MSG_description__',
    // contextMenus: the translate toggle in the context menu (issue #146) — it registers a menu item, not access to
    // page content. alarms: wakes a fresh service worker after the reader grants `nativeMessaging` at runtime — a
    // running worker never gains the API (ADR-0002, verified 2026-09-13); no install warning
    permissions: ['storage', 'contextMenus', 'alarms'],
    // nativeMessaging: image translation on a Mac reads figures through the local helper (DESIGN §15). Optional since
    // ADR-0002: requested from the reader's own click in the popup or on the settings page, so the store listing does
    // not name a native component to readers who never install it. The image e2e pre-grants it in a patched copy
    optional_permissions: ['nativeMessaging'],
    // The keyboard entry (UI.md S-P-50): the same toggle as the context menu. The popup shows the
    // binding Chrome reports, so a reader who rebinds or removes it sees the truth
    commands: { 'axt-toggle': { suggested_key: { default: 'Alt+T' }, description: '__MSG_toggle__' } },
    // background 向 LLM 端点 fetch 需要 host 权限；默认只给 OpenRouter，自定义 baseURL 在设置页保存时按 origin 申请。
    // google-web 的端点也列进来（Codex 在 #59 指出）：它眼下返 CORS 头，普通跨域就能过，
    // 但那正是这次搬迁想摆脱的依赖——对方哪天不发这个头，免费引擎就整个不可用了
    // 每个联网引擎都要在这里：MV3 的 background fetch 仍然受 CORS 约束，没有 host 权限时
    // 只能指望对方返 `Access-Control-Allow-Origin`。微软今天确实返 `*`（实测），但那是我们控制不了的
    // 依赖——它哪天不返，整个引擎就变成 `network` 失败（Codex 在 #115 指出；加 provider 时漏了这一行）
    host_permissions: ['https://openrouter.ai/*', 'https://translate-pa.googleapis.com/*', 'https://edge.microsoft.com/*'],
    // 自定义端点可能是 http 的 127.0.0.1 / 局域网（Ollama、LM Studio）；只写 localhost 字面量时申请会直接失败（Codex 在 #6 指出）。
    // 这里只是"允许申请"的范围，真正授权仍在设置页按 origin 逐个请求
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
})
