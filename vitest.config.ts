import { defineConfig } from 'vitest/config'
import { WxtVitest } from 'wxt/testing/vitest-plugin'

// WxtVitest: in-memory browser extension APIs, auto-imports, the @/ alias
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    // The fixtures link external CSS / scripts; the test environment never loads them and runs no page script
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          handleDisabledFileLoadingAsSuccess: true,
          // A unit test must produce no navigation intent. happy-dom treats `location.hash = …` as a navigation and fetches,
          // so the in-page anchor fallback (issue #44) became a real request to `http://localhost:3000/#tgt` in tests —
          // green by luck locally and on CI, and a crash in a sandbox without network (Codex hit it reviewing #131, issue #132).
          // A real browser sends no request for a same-document fragment jump, so this pulls happy-dom back to real behaviour rather than dodging the test
          navigation: { disableMainFrameNavigation: true },
        },
      },
    },
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Fixture-level tests walk every element of a 1.8 MB page, up to 6 s per case on a CI machine; the default 5 s would misreport
    testTimeout: 30_000,
  },
})
