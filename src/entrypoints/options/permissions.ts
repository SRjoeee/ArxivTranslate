// Host permissions for a reader's own endpoint. A custom origin is not in the manifest, so it is
// requested from the click that saves the service (a user gesture), and released when the service
// stops pointing at it — otherwise the granted list grows with every edit (Codex on #6).
import { browser } from 'wxt/browser'

/**
 * The two ways a host permission request fails: the address itself is invalid, or the reader declined in Chrome's prompt.
 * Reports **which one**; the sentence is in the locale pack — this layer knows no interface language (Codex on #161)
 */
export class PermissionError extends Error {
  constructor(readonly kind: 'badURL' | 'denied', readonly origin?: string) {
    super(kind)
    this.name = 'PermissionError'
  }
}


export function originPattern(url: string): string | null {
  try {
    return `${new URL(url).origin}/*`
  } catch {
    return null
  }
}

/** Returns whether **this call** is what granted it, so a save that then fails can give it back */
export async function ensureHostPermission(baseURL: string): Promise<boolean> {
  const origin = originPattern(baseURL)
  if (!origin) throw new PermissionError('badURL')
  if (await browser.permissions.contains({ origins: [origin] })) return false
  const granted = await browser.permissions.request({ origins: [origin] })
  if (!granted) throw new PermissionError('denied', origin)
  return true
}

/** Give back an origin no service uses any more; the ones the manifest asks for are not ours to remove */
export async function releaseHostPermission(previousURL: string, stillUsed: readonly string[]): Promise<void> {
  const previous = originPattern(previousURL)
  if (!previous) return
  if (stillUsed.some(url => originPattern(url) === previous)) return
  if ((browser.runtime.getManifest().host_permissions ?? []).includes(previous)) return
  await browser.permissions.remove({ origins: [previous] }).catch(() => undefined)
}
