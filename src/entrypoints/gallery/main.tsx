// Dev builds only: every popup state (UI.md §4) laid out light and dark side by side, reviewed by
// number. Actions only log. The production build drops this entrypoint (wxt.config.ts hook).
import '@/styles/ui.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { PopupActions } from '@/entrypoints/popup/data'
import { POPUP_FIXTURES } from '@/entrypoints/popup/fixtures'
import { PopupView } from '@/entrypoints/popup/PopupView'
import { derivePopupView } from '@/entrypoints/popup/view-model'

const log = (name: string) => (...args: unknown[]) => console.log(`[gallery] ${name}`, ...args)
const actions: PopupActions = {
  translate: log('translate'), retranslate: log('retranslate'), restore: log('restore'), chooseMode: log('chooseMode'), retryFailed: log('retryFailed'),
  openMenu: log('openMenu'), closeMenu: log('closeMenu'), chooseService: log('chooseService'), chooseLanguage: log('chooseLanguage'), choosePrompt: log('choosePrompt'),
  setHighlight: log('setHighlight'), setImages: log('setImages'), downloadPack: log('downloadPack'),
  copyInstallCommand: log('copyInstallCommand'), openGuide: log('openGuide'), openOptions: log('openOptions'),
}

function Gallery() {
  return (
    <div className="min-h-screen bg-bg p-8 font-ui text-fg">
      <h1 className="mb-6 text-[18px] font-bold">Popup · 状态表（docs/UI.md §4）</h1>
      <div className="flex flex-col gap-8">
        {POPUP_FIXTURES.map(f => {
          const view = derivePopupView(f.input)
          return (
            <section key={f.id} className="flex flex-col gap-2">
              <h2 className="text-[12px] font-semibold text-fg-2"><span className="mr-2 rounded bg-control px-1.5 py-0.5 font-mono text-fg">{f.id}</span>{f.name}<span className="ml-3 font-mono font-normal">{f.when}</span></h2>
              <div className="flex items-start gap-8">
                {/* transform-gpu makes each frame the containing block of the popup's fixed menu, as the popup window is */}
                <div data-theme="light" className="transform-gpu rounded-[18px] shadow-[0_8px_24px_rgba(0,0,0,0.08)]"><PopupView view={view} error={null} copied={false} actions={actions} /></div>
                <div data-theme="dark" className="transform-gpu rounded-[18px] shadow-[0_8px_24px_rgba(0,0,0,0.3)]"><PopupView view={view} error={null} copied={false} actions={actions} /></div>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Gallery /></StrictMode>)
