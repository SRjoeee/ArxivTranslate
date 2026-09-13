import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// A few constraints of the test environment itself (issue #132)

const CONFIG = readFileSync(join(import.meta.dirname, '../../vitest.config.ts'), 'utf8')

describe('vitest\'s happy-dom environment', () => {
  it('main-frame navigation off: a unit test must produce no network intent', () => {
    // happy-dom treats `location.hash = …` as a navigation and fetches it, so the in-page anchor fallback (issue #44) became
    // a real request to http://localhost:3000/#tgt in the tests. Locally and on CI it happened to be green (the failed request swallowed),
    // in a sandbox without network it blew up — Codex ran into it reviewing #131. A real browser sends no request for a same-document fragment jump,
    // so this setting pulls happy-dom back to the real behaviour.
    //
    // **It can only be asserted this way.** That fetch goes through happy-dom's internal Fetch, not `window.fetch`,
    // and cannot be spied in a test — the first version was written that way, and with the setting removed the request still went out and the test still passed.
    expect(CONFIG).toMatch(/navigation:\s*\{\s*disableMainFrameNavigation:\s*true\s*\}/)
  })

  it('no external CSS or scripts loaded, no page scripts executed', () => {
    for (const flag of ['disableCSSFileLoading', 'disableJavaScriptFileLoading', 'disableJavaScriptEvaluation']) {
      expect([flag, CONFIG.includes(`${flag}: true`)]).toEqual([flag, true])
    }
  })
})
