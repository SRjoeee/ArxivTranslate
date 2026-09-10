// The brand mark, drawn from the same vector the manifest icons are rendered from (scripts/icons.mjs).
// Decorative everywhere it is used: the name sits beside it as text, so a reader on a screen reader
// hears it once rather than twice.
//
// The path is absolute, so this belongs to the extension's **own pages** — popup, settings, gallery.
// In a content script the same string would ask arxiv.org for the file. If the paper ever needs the
// mark, read the URL from `browser.runtime.getURL` instead.
export function BrandMark({ size = 26 }: { size?: number }) {
  return <img src="/icon/logo.svg" alt="" width={size} height={size} className="block shrink-0" />
}
