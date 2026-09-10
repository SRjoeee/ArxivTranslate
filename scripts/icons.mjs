// Renders the brand mark (public/icon/logo.svg) into the PNG sizes Chrome asks for.
//
// The sizes go to public/icon/<size>.png, which is the naming WXT looks for: it fills the
// manifest's `icons` map from them, and Chrome uses that for the toolbar, the extensions page,
// the install dialog and the store. They are committed, so a normal build needs neither this
// script nor a browser; run it again whenever the logo changes.
//
// Playwright's Chromium does the rasterising — the same engine that renders the extension, and
// already a dev dependency. `sharp`, `rsvg-convert` and ImageMagick would each be a new one.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SIZES = [16, 32, 48, 96, 128]
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
// The vector is shipped too: the extension's own pages draw the mark from it at whatever size they
// need, and it stays the one file the PNGs are derived from
const svg = await readFile(resolve(root, 'public/icon/logo.svg'), 'utf8')

await mkdir(resolve(root, 'public/icon'), { recursive: true })
for (const size of SIZES) {
  await writeFile(resolve(root, `public/icon/${size}.png`), await shot(page, svg, size))
  console.log(`public/icon/${size}.png`)
}

await mkdir(resolve(root, dirname(STORE.out)), { recursive: true })
await writeFile(resolve(root, STORE.out), await shot(page, svg, STORE.size, STORE.art))
console.log(STORE.out)

await browser.close()
