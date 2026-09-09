import { defineConfig } from 'wxt'

// WXT project configuration. Add host_permissions in Phase 3 when integrating network engines.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // Disable module preload: <link rel="modulepreload" crossorigin> on extension pages causes noisy, harmless Chrome "cross-world extension resource mismatch" warnings.
  vite: () => ({ build: { modulePreload: false } }),
  manifest: {
    name: 'arXiv HTML Translator',
    // Overlays use CSS anchors; anchor-scope needs Chrome 131 (§15.2). The documented requirement was missing from
    // the manifest, allowing older Chrome to install with misaligned overlays and scroll containers outside sequential
    // focus order (Codex #99). Declare the minimum so the documented requirement is enforced.
    minimum_chrome_version: '131',
    description: 'Reversible bilingual translation for arxiv.org/html that preserves paper structure',
    // nativeMessaging: Mac image translation uses the local OCR helper (§15); unused without a helper, with no prompt.
    permissions: ['storage', 'nativeMessaging'],
    // Background LLM fetches need host permissions. Default to OpenRouter; request custom baseURL origins when saving options.
    // Include google-web too (Codex #59). It currently sends CORS headers, allowing ordinary cross-origin requests,
    // but this migration removes that dependency: losing those headers must not disable the free engine.
    host_permissions: ['https://openrouter.ai/*', 'https://translate-pa.googleapis.com/*'],
    // Custom endpoints may use HTTP at 127.0.0.1 / LAN addresses (Ollama, LM Studio); literal localhost alone rejects permission requests (Codex #6).
    // This only defines requestable origins; options still requests each origin separately.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
})
