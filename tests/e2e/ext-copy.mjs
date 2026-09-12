// A copy of the build with permissions pre-granted through its manifest. Chrome's permission prompts are native
// dialogs Playwright cannot click, and the grant flow is not what the suites test: local-endpoint pre-grants a host
// permission this way; image and the guided-install section of extension pre-grant `nativeMessaging`, optional since
// ADR-0002. **The build in .output is not touched**: the copy lives next to the profiles and is remade every run
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

export function copyWithGrants(src, dest, { permissions = [], hostPermissions = [] } = {}) {
  rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })
  const manifest = JSON.parse(readFileSync(`${dest}/manifest.json`, 'utf8'))
  manifest.permissions = [...new Set([...(manifest.permissions ?? []), ...permissions])]
  // A permission cannot be both required and optional
  manifest.optional_permissions = (manifest.optional_permissions ?? []).filter(name => !permissions.includes(name))
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), ...hostPermissions])]
  writeFileSync(`${dest}/manifest.json`, JSON.stringify(manifest, null, 2))
  return dest
}
