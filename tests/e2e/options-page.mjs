// Helpers for driving the rebuilt settings page (2026-09-10). Everything on it takes effect as it
// changes — there is no save button — so these helpers click and return; a caller that needs the
// page under test to see the change reloads that page or waits for its own signal.
import { setTimeout as sleep } from 'node:timers/promises'

/** The section names of the left navigation */
export const SECTIONS = { services: '翻译服务', reading: '阅读', prompts: '提示词与术语', data: '数据' }

export async function openOptions(context, extId) {
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extId}/options.html`)
  await options.getByRole('button', { name: SECTIONS.services, exact: true }).waitFor({ timeout: 10_000 })
  return options
}

export async function openSection(options, section) {
  await options.getByRole('button', { name: SECTIONS[section], exact: true }).click()
  await sleep(150)
}

/**
 * Click a radio and wait for it to stay checked. The controls are driven by the stored config, and
 * the write is a round trip through storage, so React repaints the old value once before the new
 * one arrives — `check()` sees that as "clicking did not change its state".
 */
export async function pick(locator) {
  for (let i = 0; i < 20; i++) {
    if (await locator.isChecked()) return
    await locator.click()
    await sleep(150)
  }
  throw new Error('radio never stayed checked')
}

/** The three built-in services are cards with a radio each; the name is the accessible name */
export async function chooseBuiltIn(options, name) {
  await openSection(options, 'services')
  await pick(options.getByRole('radio', { name, exact: true }))
}

/**
 * Add one of the reader's services through the drawer. `connect` also saves it and chooses it, so
 * this returns whatever the drawer reported (“Connected · N ms” or the reason it failed).
 */
export async function addService(options, { name, baseURL, model, apiKey = '' }) {
  await openSection(options, 'services')
  await options.getByRole('button', { name: '添加服务', exact: true }).click()
  const drawer = options.getByRole('dialog')
  await drawer.waitFor({ timeout: 5_000 })
  await drawer.getByLabel('名称').fill(name)
  await drawer.getByLabel('接口地址').fill(baseURL)
  if (apiKey) await drawer.getByLabel('API Key').fill(apiKey)
  await drawer.getByLabel('模型', { exact: true }).fill(model)
  await drawer.getByRole('button', { name: '连接', exact: true }).click()
  // The result line lands in the footer; give the request the same budget the page does
  await sleep(500)
  for (let i = 0; i < 60 && await drawer.getByRole('button', { name: '连接中…' }).count() > 0; i++) await sleep(500)
  const result = await drawer.locator('footer span').last().textContent().catch(() => '')
  await options.keyboard.press('Escape')
  await sleep(150)
  return result ?? ''
}

/**
 * Open a service, clear its key, connect again. Returns what the drawer reported — with no key the
 * endpoint answers `no-key`, so this proves “Clear” actually cleared it rather than writing the old
 * key back (the drawer opens with the stored key in its form, and reading that prop instead of the
 * form is the mistake this guards).
 */
export async function clearKeyAndReconnect(options) {
  await openSection(options, 'services')
  await options.getByRole('button', { name: '编辑', exact: true }).last().click()
  const drawer = options.getByRole('dialog')
  await drawer.waitFor({ timeout: 5_000 })
  await drawer.getByRole('button', { name: '清除', exact: true }).click()
  await drawer.getByRole('button', { name: '连接', exact: true }).click()
  await sleep(500)
  for (let i = 0; i < 40 && await drawer.getByRole('button', { name: '连接中…' }).count() > 0; i++) await sleep(500)
  const result = await drawer.locator('footer span').last().textContent().catch(() => '')
  await options.keyboard.press('Escape')
  await sleep(150)
  return result ?? ''
}

/** A switch anywhere on the page, by its accessible name */
export async function setSwitch(options, name, on) {
  const control = options.getByRole('switch', { name, exact: true })
  for (let i = 0; i < 20; i++) {
    if (await control.getAttribute('aria-checked') === String(on)) return
    await control.click()
    await sleep(150)
  }
  throw new Error(`switch ${name} never became ${on}`)
}

/** The image modes are ordinary checkboxes in the services section */
export async function setImageMode(options, name, on) {
  await openSection(options, 'services')
  const box = options.getByRole('checkbox', { name, exact: true })
  for (let i = 0; i < 20; i++) {
    if (await box.isChecked() === on) return
    await box.click()
    await sleep(150)
  }
  throw new Error(`image mode ${name} never became ${on}`)
}

/** Choose an appearance profile by the name on its tile */
export async function chooseStyle(options, name) {
  await openSection(options, 'reading')
  await options.getByRole('button', { name, exact: true }).click()
  await sleep(200)
}

/** The target language lives behind the searchable menu of the services section */
export async function chooseLanguage(options, search, name) {
  await openSection(options, 'services')
  await options.getByRole('button', { name: '目标语言' }).click()
  await options.getByPlaceholder('搜索语言').fill(search)
  await options.getByRole('option', { name: new RegExp(name) }).first().click()
  await sleep(200)
}

/** The “how far ahead to translate” range and the “when to start translating” threshold are named stops, not numbers */
export async function setPreload(options, { range, threshold }) {
  await openSection(options, 'reading')
  if (range) await options.getByRole('button', { name: range, exact: true }).click()
  if (threshold) await options.getByRole('button', { name: threshold, exact: true }).click()
  await sleep(150)
}

/**
 * Switch the interface's language and wait for the page it reloads (UI.md §6). `name` is the
 * language's own name, which is how the menu lists it
 */
export async function chooseUiLanguage(options, label, name) {
  await options.getByRole('button', { name: new RegExp(label) }).click()
  await sleep(200)
  await options.getByRole('option', { name, exact: true }).click()
  await options.waitForLoadState('domcontentloaded')
  await sleep(600)
}
