// Drafts in progress on a page — a service being edited in its drawer, an appearance profile, a prompt, a glossary
// that does not parse yet — are local until their own save. The page must not reload under one: a change saved
// elsewhere that takes a reload to apply (the interface language) waits for the last draft to close (the local review
// of S1, fourth pass).

export interface Drafts {
  /** A draft begins; the returned function ends it, once */
  hold(): () => void
  any(): boolean
  /** Run `fn` now when no draft is open, otherwise once the last one has closed */
  whenNone(fn: () => void): void
}

export function createDrafts(): Drafts {
  let open = 0
  let waiting: (() => void)[] = []
  return {
    hold() {
      open++
      let held = true
      return () => {
        if (!held) return
        held = false
        if (--open > 0) return
        const run = waiting
        waiting = []
        for (const fn of run) fn()
      }
    },
    any: () => open > 0,
    whenNone(fn) {
      if (open === 0) fn()
      else waiting.push(fn)
    },
  }
}

/** The page's drafts: one registry per page, shared by the components that hold drafts and the data layer that defers */
export const drafts = createDrafts()
