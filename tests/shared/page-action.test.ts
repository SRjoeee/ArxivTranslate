import { describe, expect, it } from 'vitest'
import type { Progress } from '@/core/pipeline/run'
import { behindSettings, messageFor, pageAction, pageDecision } from '@/shared/page-action'

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

describe('pageDecision', () => {
  const saved = (over: Partial<{ revision: string | null; canRun: boolean; fallback: boolean }> = {}) => ({ revision: 'r1', canRun: true, fallback: false, ...over })

  it('a running page always restores; a page behind the settings re-translates only on settings that run on their own (a fallback is not what the reader chose)', () => {
    const on = { progress: progress('on'), running: running('r1') }
    expect(pageDecision(on, saved({ canRun: false }))).toEqual({ action: 'restore', behind: false, enabled: true })
    expect(pageDecision(on, saved({ revision: 'r2' }))).toEqual({ action: 'retranslate', behind: true, enabled: true })
    expect(pageDecision(on, saved({ revision: 'r2', canRun: false, fallback: true }))).toEqual({ action: 'retranslate', behind: true, enabled: false })
  })

  it('a page that is not translated, or paused, starts when the chosen service runs or a fallback would', () => {
    expect(pageDecision({ progress: progress('idle') }, saved({ canRun: false, fallback: true }))).toEqual({ action: 'translate', behind: false, enabled: true })
    expect(pageDecision({ progress: progress('idle') }, saved({ canRun: false, fallback: false }))).toEqual({ action: 'translate', behind: false, enabled: false })
    expect(pageDecision({ progress: progress('stopped', 'auth: bad key') }, saved({ canRun: false, fallback: true }))).toEqual({ action: 'retranslate', behind: false, enabled: true })
    expect(pageDecision(undefined, saved())).toBeUndefined()
  })
})
