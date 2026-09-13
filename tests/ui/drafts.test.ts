import { describe, expect, it } from 'vitest'
import { createDrafts } from '@/ui/drafts'

// Drafts in progress hold a page's reload until the last of them closes (ui/drafts.ts)

describe('createDrafts', () => {
  it('runs at once when no draft is open', () => {
    const drafts = createDrafts()
    const ran: string[] = []
    drafts.whenNone(() => ran.push('now'))
    expect(ran).toEqual(['now'])
    expect(drafts.any()).toBe(false)
  })

  it('waits for the last open draft, then runs what waited in order', () => {
    const drafts = createDrafts()
    const ran: string[] = []
    const releaseA = drafts.hold()
    const releaseB = drafts.hold()
    drafts.whenNone(() => ran.push('first'))
    drafts.whenNone(() => ran.push('second'))
    expect(drafts.any()).toBe(true)
    releaseA()
    expect(ran).toEqual([])
    releaseB()
    expect(ran).toEqual(['first', 'second'])
    expect(drafts.any()).toBe(false)
  })

  it('a release ends its own hold once: released twice, it does not end another draft', () => {
    const drafts = createDrafts()
    const ran: string[] = []
    const releaseA = drafts.hold()
    drafts.hold()
    drafts.whenNone(() => ran.push('ran'))
    releaseA()
    releaseA()
    expect(ran).toEqual([])
    expect(drafts.any()).toBe(true)
  })

  it('what waited runs once; a draft opened afterwards holds only what comes later', () => {
    const drafts = createDrafts()
    const ran: string[] = []
    const release = drafts.hold()
    drafts.whenNone(() => ran.push('ran'))
    release()
    const again = drafts.hold()
    expect(ran).toEqual(['ran'])
    drafts.whenNone(() => ran.push('later'))
    expect(ran).toEqual(['ran'])
    again()
    expect(ran).toEqual(['ran', 'later'])
  })
})
