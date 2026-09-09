import type { AxtResponse } from './messages'

/** Background axt:ping handler, extracted for unit tests. */
export function handlePing(version: string): AxtResponse<'axt:ping'> {
  return { ok: true, version }
}
