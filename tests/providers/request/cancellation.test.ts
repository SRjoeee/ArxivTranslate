// Ported from reference/read-frog/src/utils/request/__tests__/cancellation.test.ts@9b44f82 (GPL-3.0), 2026-09-05, modified:
// import path; 2026-09-12 (ADR-0005) the prefix, TTL and size-cap cases are gone with the registry's rewrite — it no longer expires.
import { describe, expect, it } from "vitest"
import {
  CancelledScopeRegistry,
  isTranslationCancelledError,
  TRANSLATION_CANCELLED_ERROR_NAME,
  TranslationCancelledError,
} from "@/providers/request/cancellation"

describe("isTranslationCancelledError", () => {
  it("recognizes a same-realm instance", () => {
    expect(isTranslationCancelledError(new TranslationCancelledError("7:sess"))).toBe(true)
  })

  it("recognizes the messaging-boundary shape (plain Error carrying only the name)", () => {
    // @webext-core/messaging re-creates background rejections on the content
    // side via @aklinker1/zero-serialize-error as `Error(msg)` with `.name`
    // copied — the prototype (and thus instanceof) is lost. Detection MUST be
    // name-based; this pins that so a refactor to `instanceof` can't slip
    // through green (#1881).
    const crossBoundary = Object.assign(new Error("Translation request cancelled"), {
      name: TRANSLATION_CANCELLED_ERROR_NAME,
    })
    expect(crossBoundary).not.toBeInstanceOf(TranslationCancelledError)
    expect(isTranslationCancelledError(crossBoundary)).toBe(true)
  })

  it("rejects unrelated errors and non-errors", () => {
    expect(isTranslationCancelledError(new Error("boom"))).toBe(false)
    expect(isTranslationCancelledError({ name: TRANSLATION_CANCELLED_ERROR_NAME })).toBe(false)
    expect(isTranslationCancelledError(undefined)).toBe(false)
    expect(isTranslationCancelledError("cancelled")).toBe(false)
  })
})

describe("cancelledScopeRegistry", () => {
  it("remembers exact cancelled scopes", () => {
    const registry = new CancelledScopeRegistry()
    registry.markScope("7:session-a")

    expect(registry.has("7:session-a")).toBe(true)
    expect(registry.has("7:session-b")).toBe(false)
    expect(registry.has("8:session-a")).toBe(false)
  })
})
