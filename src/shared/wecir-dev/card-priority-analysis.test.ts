import { describe, expect, it } from 'vitest'
import {
  calculateWecirDevPriority,
  sortWecirDevAnalyses,
  type WecirDevPriorityInput
} from './card-priority-analysis'

const base: WecirDevPriorityInput = {
  number: 1,
  title: 'Task',
  labels: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
  now: '2026-01-01T00:00:00.000Z'
}

function score(labels: string[], extra: Partial<WecirDevPriorityInput> = {}) {
  return calculateWecirDevPriority({ ...base, labels, ...extra })
}

describe('Wecir Dev card priority analysis', () => {
  it.each([
    ['critical', 100],
    ['blocker', 100],
    ['high', 70],
    ['medium', 40],
    ['low', 10]
  ])('assigns severity %s as %s points', (label, points) => {
    expect(score([label]).score).toBe(points)
  })

  it('applies additive risk, milestone, dependency, draft, and impact rules', () => {
    const result = score(['high', 'bug', 'experimental'], {
      draft: true,
      milestone: 'v1',
      impactedIssueCount: 2,
      dependency: {
        dependsOn: [2],
        blockedCount: 2,
        cycleDetected: false,
        topoLevel: 1,
        cycleNodes: []
      }
    })
    expect(result.score).toBe(70 + 30 + 20 + 20 + 15 - 20 - 10)
    expect(result.priorityBand).toBe('P0')
    expect(result.suggestedTier).toBe('complex')
    expect(result.scoreDetails.map((detail) => detail.rule)).toEqual([
      'high',
      'impact-risk',
      'multiple-impact',
      'multiple-dependents',
      'milestone',
      'blocked',
      'draft-experimental'
    ])
  })

  it('takes the highest severity regardless of label order', () => {
    expect(score(['low', 'priority: critical']).score).toBe(100)
    expect(score(['severity: critical', 'priority: high', 'low']).score).toBe(100)
  })

  it('normalizes invalid stale configuration safely', () => {
    const input = {
      updatedAt: '2025-01-01T00:00:00.000Z',
      now: '2026-01-01T00:00:00.000Z'
    }
    expect(
      calculateWecirDevPriority(
        { ...base, ...input },
        {
          staleAfterDays: -10,
          stalePointsPerDay: -2,
          staleMaxPoints: -5
        }
      ).score
    ).toBe(0)
    expect(
      calculateWecirDevPriority(
        { ...base, ...input },
        {
          staleAfterDays: Number.NaN,
          stalePointsPerDay: Number.NaN,
          staleMaxPoints: Number.NaN
        }
      ).score
    ).toBe(20)
    expect(
      calculateWecirDevPriority(
        { ...base, ...input },
        {
          staleAfterDays: 0,
          stalePointsPerDay: 2,
          staleMaxPoints: 3
        }
      ).score
    ).toBe(3)
  })

  it('adds stale points after the threshold and caps the contribution', () => {
    const result = score([], {
      updatedAt: '2025-01-01T00:00:00.000Z',
      now: '2026-01-01T00:00:00.000Z'
    })
    expect(result.score).toBe(20)
    expect(result.scoreDetails).toContainEqual(
      expect.objectContaining({ rule: 'stale', points: 20 })
    )
    expect(
      score([], { updatedAt: '2025-12-15T00:00:00.000Z', now: '2026-01-01T00:00:00.000Z' }).score
    ).toBe(0)
  })

  it('reports cycles without changing the rule score', () => {
    const result = score(['high'], {
      dependency: {
        dependsOn: [2],
        blockedCount: 0,
        cycleDetected: true,
        topoLevel: 0,
        cycleNodes: [1, 2]
      }
    })
    expect(result.score).toBe(50)
    expect(result.cycleWarning).toContain('#1, #2')
    expect(result.confidence).toBeLessThan(1)
  })

  it('sorts deterministically by topology, band, dependents, date, and issue number', () => {
    const make = (number: number, overrides: Partial<WecirDevPriorityInput> = {}) => {
      const input = { ...base, number, ...overrides }
      return { ...input, ...calculateWecirDevPriority(input) }
    }
    const items = [
      make(3, {
        labels: ['low'],
        updatedAt: '2026-01-03T00:00:00.000Z',
        dependency: {
          dependsOn: [],
          blockedCount: 0,
          cycleDetected: false,
          topoLevel: 1,
          cycleNodes: []
        }
      }),
      make(2, {
        labels: ['critical'],
        dependency: {
          dependsOn: [],
          blockedCount: 0,
          cycleDetected: true,
          topoLevel: 2,
          cycleNodes: [2]
        }
      }),
      make(1, {
        labels: ['critical'],
        dependency: {
          dependsOn: [],
          blockedCount: 0,
          cycleDetected: false,
          topoLevel: 0,
          cycleNodes: []
        }
      })
    ]
    expect(sortWecirDevAnalyses(items).map((item) => item.number)).toEqual([1, 3, 2])
    expect(sortWecirDevAnalyses(items.toReversed()).map((item) => item.number)).toEqual([1, 3, 2])
  })

  it('uses issue number as the final tie-break for invalid timestamps', () => {
    const make = (number: number, updatedAt: string) => {
      const input = { ...base, number, updatedAt }
      return { ...input, ...calculateWecirDevPriority(input) }
    }
    const items = [make(3, 'not-a-date'), make(1, 'also-invalid'), make(2, 'not-a-date')]
    expect(sortWecirDevAnalyses(items).map((item) => item.number)).toEqual([1, 2, 3])
  })
})
