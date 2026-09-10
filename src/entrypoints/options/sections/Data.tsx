// 数据: what the extension keeps on this machine. Today that is the translation cache; the
// diagnostics export (#156) will join it here.
import { Confirm } from '@/ui/Confirm'
import { O } from '@/ui/strings'
import type { OptionsData } from '../data'

export function Data({ data }: { data: OptionsData }) {
  const { cache, cacheError, clearCache, cacheCleared } = data
  return (
    <div className="rounded-card border border-line bg-card px-3.5 py-3">
      <div className="flex items-center justify-between gap-4">
        <span className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold">{O.data.cache}</span>
          <span className="text-[11px] text-fg-2">
            {/* 读不到就说读不到：显示成「0 条」会让用户以为缓存是空的（Codex 在 #52 指出） */}
            {cacheError ? O.data.cacheError : cache ? O.data.cacheLine(cache.entries, (cache.bytes / 1024 / 1024).toFixed(1)) : '…'}
          </span>
        </span>
        {cacheCleared
          ? <span className="text-[12px] font-semibold text-fg-2">{O.data.cleared}</span>
          : <Confirm label={O.data.clear} confirmLabel={O.data.clearConfirm} cancelLabel={O.services.cancel} onConfirm={() => void clearCache()} />}
      </div>
      <p className="mt-2 text-[11px] text-fg-2">{O.data.cacheHint}</p>
    </div>
  )
}
