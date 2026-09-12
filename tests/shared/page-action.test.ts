import { describe, expect, it } from 'vitest'
import type { Progress } from '@/core/pipeline/run'
import { behindSettings, messageFor, pageAction } from '@/shared/page-action'

// One decision for the popup's main button and the toggle (INVENTORY S2)

const progress = (state: Progress['state'], fatal?: string): Progress => ({ state, total: 10, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0, ...(fatal ? { fatal } : {}) })
const running = (revision: string) => ({ provider: 'microsoft', target: 'cmn', engine: 'microsoft', revision })

describe('pageAction', () => {
  it('a page that is not translated translates; a running one restores; a paused one (a fatal error) retries', () => {
    expect(pageAction({ progress: progress('idle') }, 'r1')).toBe('translate')
    expect(pageAction({ progress: progress('on'), running: running('r1') }, 'r1')).toBe('restore')
    expect(pageAction({ progress: progress('stopped', 'auth: bad key') }, 'r1')).toBe('retranslate')
    // Stopped without a fatal error is not a paused page: it starts afresh, as the button 翻译本页 says
    expect(pageAction({ progress: progress('stopped') }, 'r1')).toBe('translate')
    // No answer from the page: nothing, not a guess
    expect(pageAction(undefined, 'r1')).toBeUndefined()
  })

  it('a running page whose revision is not the saved settings\' digest is behind them and re-translates; an unknown digest never puts a page behind', () => {
    expect(behindSettings({ progress: progress('on'), running: running('r1') }, 'r2')).toBe(true)
    expect(pageAction({ progress: progress('on'), running: running('r1') }, 'r2')).toBe('retranslate')
    expect(behindSettings({ progress: progress('on'), running: running('r1') }, null)).toBe(false)
    expect(behindSettings({ progress: progress('idle'), running: running('r1') }, 'r2')).toBe(false)
    expect(behindSettings({ progress: progress('on') }, 'r2')).toBe(false)
  })

  it('each action is the message the popup\'s button sends: a re-translation restarts the session in place', () => {
    expect(messageFor('translate')).toEqual({ type: 'axt:translate-page' })
    expect(messageFor('retranslate')).toEqual({ type: 'axt:translate-page', restart: true })
    expect(messageFor('restore')).toEqual({ type: 'axt:restore-page' })
  })
})
