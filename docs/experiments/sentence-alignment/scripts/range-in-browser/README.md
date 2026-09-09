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
