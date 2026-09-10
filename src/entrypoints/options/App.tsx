// The settings page: a left navigation and four sections, on the popup's tokens and dark mode.
// There is no save button — every control writes the config as it changes, and the drawers commit
// with one button (docs/UI.md §3.2, rebuilt 2026-09-10).
import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { O } from '@/ui/strings'
import { useOptionsData } from './data'
import { Data } from './sections/Data'
import { Prompts } from './sections/Prompts'
import { Reading } from './sections/Reading'
import { Services } from './sections/Services'

const SECTIONS = ['services', 'reading', 'prompts', 'data'] as const
type Section = (typeof SECTIONS)[number]
const isSection = (v: string): v is Section => (SECTIONS as readonly string[]).includes(v)

export function App() {
  const data = useOptionsData()
  // The hash keeps the place across a reload, and lets a note in the popup link straight here
  const [section, setSection] = useState<Section>(() => {
    const hash = location.hash.slice(1)
    return isSection(hash) ? hash : 'services'
  })
  useEffect(() => { location.hash = section }, [section])

  return (
    <div className="min-h-screen bg-bg font-ui text-[13px] text-fg">
      <div className="mx-auto flex max-w-[900px] gap-8 px-6 py-8">
        <nav aria-label={O.title} className="w-[140px] shrink-0">
          <h1 className="mb-4 px-3 text-[15px] font-bold">{O.title}</h1>
          {SECTIONS.map(id => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? 'page' : undefined}
              onClick={() => setSection(id)}
              className={`mb-1 block w-full cursor-pointer rounded-control px-3 py-2 text-left text-[13px] font-semibold ${section === id ? 'bg-card text-fg shadow-[0_1px_2px_rgba(30,30,36,0.06)]' : 'text-fg-2 hover:text-fg'}`}
            >
              {O.nav[id]}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          {data.fallbackReason && (
            <p className="mb-6 rounded-card bg-accent-soft px-3.5 py-3 text-[12px] leading-relaxed text-accent">
              {O.fallbackNotice}
              <span className="mt-1 block text-fg-2">{data.fallbackReason}</span>
            </p>
          )}
          {section === 'services' && <Services data={data} extensionId={browser.runtime.id} />}
          {section === 'reading' && <Reading data={data} />}
          {section === 'prompts' && <Prompts data={data} />}
          {section === 'data' && <Data data={data} />}
        </main>
      </div>
    </div>
  )
}
