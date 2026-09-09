# rangesOf in a real browser

happy-dom returns an empty string from `Range.toString()` and misreports `startOffset`, so the unit
tests in `tests/protector/offsets.test.ts` assert which boundary calls are made rather than what the
resulting range selects. This probe closes that gap: it bundles `serialize` and `rangesOf` with
esbuild, injects them into a real arXiv page with Playwright, and compares `range.toString()`
against the wire text for every text span.

```
node run.mjs <bundle.js>

npx esbuild entry.ts --bundle --format=iife --outfile=bundle.js --alias:@=<repo>/src
```

Comparison is modulo HTML whitespace: the wire text is collapsed (#119) while the DOM still holds
the original newlines, so `range.toString()` legitimately returns `\n` where the wire has a space.
Comparing without collapsing was the first version and reported false mismatches.

Result on 2609.04056v1 with the code from PR #123:

```
blocks            769
intervals checked 656
exact             656
injected case     2 ranges, contains the injected node: false
```

The injected case splits a text node, inserts a `.axt-t` element between the halves, re-serialises
and asks for the whole interval — the range must come back in two pieces with the injected text
outside both.

## The invariant: no range may contain injected content

`invariant.mjs` checks the property directly instead of one case at a time. Three consecutive fixes
on #123 each broke a different form of the same thing — an injected node between two spans, inside a
void slot, and inside a paired element — because each fix only had one form in view. This clones
every block, plants an `.axt-t` in five different positions, and asserts no produced range contains
its text.

```
node invariant.mjs <bundle.js>
```

With #123 at d4cb3d7:

```
placement      blocks  ranges  violations
sibling           260     260           0
insideVoid        147     583           0
insidePaired      179     413           0
afterPaired       179     319           0
firstChild        260     260           0
```

**The probe was validated against itself**, because zero violations otherwise proves nothing:
disabling the void-slot carve reports 201 violations, and disabling the between-spans detection
reports 214, both concentrated in exactly the placements those code paths serve.
