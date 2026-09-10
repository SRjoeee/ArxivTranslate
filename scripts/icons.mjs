// Renders the two brand marks into the PNG sizes Chrome asks for.
//
// There are two because the two places are different surfaces:
//   - public/icon/tile.svg — the book on a white rounded tile, the app-icon shape. It goes to
//     public/icon/<size>.png, the naming WXT looks for, and fills the manifest's `icons`: the
//     extensions page, the install dialog and the store, where an icon sits on a card of its own.
//   - public/icon/toolbar.svg — the bare book with a white outline, no tile. It goes to
//     public/icon/toolbar-<size>.png, declared as `action.default_icon` in wxt.config.ts, for the
//     browser's own toolbar, where a white tile would read as a sticker and the outline is what
//     keeps the mark legible on both a light and a dark toolbar.
// Both are committed, so a normal build needs neither this script nor a browser; run it again
// whenever a mark changes.
//
// Playwright's Chromium does the rasterising — the same engine that renders the extension, and
// already a dev dependency. `sharp`, `rsvg-convert` and ImageMagick would each be a new one.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SIZES = [16, 32, 48, 96, 128]
/** The toolbar sizes Chrome actually asks the action for */
const ACTION_SIZES = [16, 32, 48]
/**
 * The store listing wants the art inset in its canvas rather than bleeding to the edge, so it is a
 * separate file: 96 of artwork centred in 128. It is uploaded by hand and must not ship inside the
 * extension, which is why it lands in docs/ and not public/
 */
const STORE = { size: 128, art: 96, out: 'docs/brand/store-icon-128.png' }

const shot = async (page, svg, size, art = size) => {
  const pad = (size - art) / 2
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><style>
       html,body { margin: 0; background: transparent }
       .box { width: ${size}px; height: ${size}px; padding: ${pad}px; box-sizing: border-box }
       svg { display: block; width: ${art}px; height: ${art}px }
     </style><div class="box">${svg}</div>`,
  )
  return page.locator('.box').screenshot({ omitBackground: true })
}

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
// The vectors ship too: the extension's own pages draw the tile from it at whatever size they need,
// and it stays the one file its PNGs are derived from
const tile = await readFile(resolve(root, 'public/icon/tile.svg'), 'utf8')
const toolbar = await readFile(resolve(root, 'public/icon/toolbar.svg'), 'utf8')

await mkdir(resolve(root, 'public/icon'), { recursive: true })
for (const size of SIZES) {
  await writeFile(resolve(root, `public/icon/${size}.png`), await shot(page, tile, size))
  console.log(`public/icon/${size}.png`)
}
for (const size of ACTION_SIZES) {
  await writeFile(resolve(root, `public/icon/toolbar-${size}.png`), await shot(page, toolbar, size))
  console.log(`public/icon/toolbar-${size}.png`)
}

await mkdir(resolve(root, dirname(STORE.out)), { recursive: true })
await writeFile(resolve(root, STORE.out), await shot(page, tile, STORE.size, STORE.art))
console.log(STORE.out)

await browser.close()
