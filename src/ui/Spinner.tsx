// The loading ring on the extension's own pages: a red quarter arc, for a wait with one subject —
// the offline pack downloading. In the paper it is a skeleton instead (DESIGN §7.6): hundreds of
// blocks wait at once there, and a placeholder the size of the coming translation says more
export function Spinner({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block size-[10px] rounded-full border-2 border-current/25 border-t-current motion-safe:animate-[axt-spin_0.9s_linear_infinite] ${className}`} />
}
