import { describe, expect, it } from 'vitest'
import { isTopLevelView } from './top-level-view'

describe('isTopLevelView', () => {
  it('accepts the cards top-level view', () => {
    expect(isTopLevelView('cards')).toBe(true)
  })

  it('rejects unknown and inherited object keys', () => {
    expect(isTopLevelView('unknown')).toBe(false)
    expect(isTopLevelView('constructor')).toBe(false)
    expect(isTopLevelView('__proto__')).toBe(false)
  })
})
