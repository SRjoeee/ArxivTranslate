import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

// The WXT project configuration. host_permissions arrive with the network engines in Phase 3.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // In extension pages <link rel="modulepreload" crossorigin> triggers Chrome's "cross-world extension resource mismatch" warning (harmless but noisy); preloading is off
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
    // The image overlay uses CSS anchor positioning, and `anchor-scope` needs Chrome 131 (§15.2). The document always said so, but it never reached
    // the manifest: a Chrome below that version installs the extension all the same and gets a misplaced overlay, and its scroll containers do not enter
    // sequential focus either (Codex on #99). Declared, so the floor the document states really applies
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
    // The background's fetch to an LLM endpoint needs a host permission; by default only OpenRouter, a custom baseURL is requested by origin when saved on the settings page.
    // google-web's endpoint is listed too (Codex on #59): today it returns CORS headers and an ordinary cross-origin request passes,
    // but that is exactly the dependency this move wants to shed — the day they stop sending the header the free engine is unusable whole
    // Every network engine has to be here: an MV3 background fetch is still bound by CORS, and without a host permission it can only
    // hope for `Access-Control-Allow-Origin` from the other side. Microsoft does return `*` today (measured), but that is a dependency
    // beyond our control — the day it stops, the whole engine becomes a `network` failure (Codex on #115; the line was missed when the provider was added)
    host_permissions: ['https://openrouter.ai/*', 'https://translate-pa.googleapis.com/*', 'https://edge.microsoft.com/*'],
    // A custom endpoint may be http on 127.0.0.1 / the LAN (Ollama, LM Studio); with only the localhost literal the request fails outright (Codex on #6).
    // This is only the range that may be requested; the real grant is still asked for per origin on the settings page
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
})
