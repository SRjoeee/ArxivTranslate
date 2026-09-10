// The live preview of one appearance profile, rendered with the **real** injected sheet.
//
// It must be an iframe, not a shadow root (Codex on #106): every rule starts at `html[data-axt-*]`,
// and a shadow tree has no document root to match — inside one, not a single rule applies. An
// iframe has a real `<html>` to write the attributes on, so what is shown here is what the page
// gets; it also isolates the rules from the settings page itself.
import { appearanceSheet } from '@/core/renderer'
import type { HighlightProfile, Look, StyleProfile } from '@/config/appearance'
import { O } from '@/ui/strings'



export function Preview({ style, highlight, band = false, height = 96 }: { style: StyleProfile; highlight: HighlightProfile; band?: boolean; height?: number }) {
  const look: Look = { style, highlight }
  const attrs = [
    'data-axt-on',
    style.underline === 'none' ? '' : `data-axt-underline="${style.underline}"`,
    style.blur ? 'data-axt-blur' : '',
  ].filter(Boolean).join(' ')
  // The band is an absolutely positioned box on <body> in the real page; here one span is enough
  // to show the colour at its strength, which is the only thing this profile decides
  const body = band
    ? `<p>${O.reading.previewSource.replace('bounded', '<span class="band">bounded</span>')}</p>`
      + `<p class="axt-t" lang="zh-CN">${O.reading.previewTarget.replace('有界的', '<span class="band">有界的</span>')}</p>`
    : `<p>${O.reading.previewSource}</p><p class="axt-t" lang="zh-CN">${O.reading.previewTarget}</p>`
  const srcDoc = `<!doctype html><html ${attrs}><head><meta charset="utf-8">`
    + `<style>${appearanceSheet(look)}`
    + 'body{margin:0;padding:10px 12px;font:14px/1.7 system-ui;color:#1e1e24;background:#fff}'
    + '.band{background-color:color-mix(in oklab, var(--axt-hl-color, var(--axt-green)) var(--axt-hl-mix, 22%), transparent);border-radius:2px}'
    + '</style></head><body>' + body + '</body></html>'
  return (
    <div className="mb-4">
      <div className="mb-1 text-[11px] font-semibold text-fg-2">{O.reading.preview}</div>
      <iframe title={O.reading.preview} srcDoc={srcDoc} className="w-full rounded-control border border-line bg-white" style={{ height }} />
    </div>
  )
}
