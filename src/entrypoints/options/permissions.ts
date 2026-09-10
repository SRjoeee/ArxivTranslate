// Host permissions for a reader's own endpoint. A custom origin is not in the manifest, so it is
// requested from the click that saves the service (a user gesture), and released when the service
// stops pointing at it — otherwise the granted list grows with every edit (Codex on #6).
import { browser } from 'wxt/browser'

export function originPattern(url: string): string | null {
  try {
    return `${new URL(url).origin}/*`
  } catch {
    return null
  }
}

export async function ensureHostPermission(baseURL: string): Promise<void> {
  const origin = originPattern(baseURL)
  if (!origin) throw new Error('接口地址不合法')
  if (await browser.permissions.contains({ origins: [origin] })) return
  const granted = await browser.permissions.request({ origins: [origin] })
  if (!granted) throw new Error(`未授予对 ${origin} 的访问权限`)
}

/** Give back an origin no service uses any more; the ones the manifest asks for are not ours to remove */
export async function releaseHostPermission(previousURL: string, stillUsed: readonly string[]): Promise<void> {
  const previous = originPattern(previousURL)
  if (!previous) return
  if (stillUsed.some(url => originPattern(url) === previous)) return
  if ((browser.runtime.getManifest().host_permissions ?? []).includes(previous)) return
  await browser.permissions.remove({ origins: [previous] }).catch(() => undefined)
}
