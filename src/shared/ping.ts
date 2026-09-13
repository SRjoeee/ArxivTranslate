import type { AxtResponse } from './messages'

/** The background's axt:ping handler, factored out for unit tests */
export function handlePing(version: string): AxtResponse<'axt:ping'> {
  return { ok: true, version }
}
