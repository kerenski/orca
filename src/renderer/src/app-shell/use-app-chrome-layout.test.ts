import { describe, expect, it } from 'vitest'
import { shouldShowAppSidebar } from './use-app-chrome-layout'

describe('shouldShowAppSidebar', () => {
  it('keeps the sidebar mounted for Cards and Tasks navigation pages', () => {
    expect(shouldShowAppSidebar('cards')).toBe(true)
    expect(shouldShowAppSidebar('tasks')).toBe(true)
  })

  it('hides the sidebar for full-page settings surfaces', () => {
    expect(shouldShowAppSidebar('settings')).toBe(false)
    expect(shouldShowAppSidebar('activity')).toBe(false)
    expect(shouldShowAppSidebar('space')).toBe(false)
  })
})
