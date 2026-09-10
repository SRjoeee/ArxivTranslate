// The loading ring: a red quarter arc, the same mark the in-page components use (UI.md, in-page section)
export function Spinner({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block size-[10px] rounded-full border-2 border-current/25 border-t-current motion-safe:animate-[axt-spin_0.9s_linear_infinite] ${className}`} />
}
