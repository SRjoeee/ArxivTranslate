import '@/styles/ui.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyLocale } from '@/ui/apply-locale'
import { App } from './App'

// The pack first, then the first paint: see ui/apply-locale.ts
await applyLocale(brand => brand)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
