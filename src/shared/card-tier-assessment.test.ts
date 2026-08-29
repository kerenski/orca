import { describe, expect, it } from 'vitest'
import { assessCardTier, normalizeCardId } from './card-tier-assessment'

describe('card tier assessment', () => {
  it('normalizes card ids and parses title prefixes', () => {
    expect(normalizeCardId('M1-04')).toBe('m1-04')
    expect(assessCardTier({ title: 'M1-04 Fix button style' }).cardId).toBe('m1-04')
  })

  it('classifies explicit complexity signals deterministically', () => {
    expect(assessCardTier({ title: 'M1-01 Add RBAC permission state machine' }).tier).toBe(
      'complex'
    )
    expect(assessCardTier({ title: 'M1-02 Add frontend API integration' }).tier).toBe('medium')
    expect(assessCardTier({ title: 'M1-03 Fix CSS on single page' }).tier).toBe('simple')
  })

  it('degrades conservatively when evidence is missing', () => {
    const result = assessCardTier({ title: 'A task' })
    expect(result.tier).toBe('simple')
    expect(result.confidence).toBeLessThan(0.5)
    expect(result.reasons.length).toBeGreaterThan(0)
  })
})
