import { defineConfig } from 'vitest/config'
import { WxtVitest } from 'wxt/testing/vitest-plugin'

// WxtVitest: in-memory extension APIs, auto-imports, and the @/ alias
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    // Fixtures reference external CSS / scripts; never load them or execute page scripts in tests.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Fixture tests traverse all elements of 1.8 MB pages; one case can take 6 s in CI, exceeding the default 5 s timeout.
    testTimeout: 30_000,
  },
})
