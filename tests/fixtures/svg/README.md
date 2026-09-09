# SVG figure fixtures

Real `<object type="image/svg+xml">` figures from arXiv, byte for byte, named
`<arxiv-id>-<original filename>.svg`. Captured 2026-09-09 for issue #121.

- **2609.03768-fig_closure.svg** — a plot. 64 glyphs, 24 of them rotated, axis
  labels (`wall time per epoch [ms]`), numeric ticks, and a `&#x00d7;` entity
  inside a `data-text` attribute.
- **2608.29808-bounter-case.svg** — a syntax-highlighted code listing. 913
  glyphs, none rotated. This is the figure that shows the dropped-space problem
  (`if log_counting` arrives as `iflog_counting`), and the one the code filter
  has to reject.

They are not trimmed. The parser only reads the `<svg>` element's `viewBox` and
the `<use data-text transform>` elements, so the glyph outlines in `<defs>` are
dead weight to it — but a fixture that has been edited is no longer evidence of
what arXiv actually serves, and 288 KB next to 9.1 MB of HTML fixtures is not
worth that.
