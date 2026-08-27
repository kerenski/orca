import { describe, expect, it } from 'vitest'
import { WECIR_DEV_SCHEMA_VERSION } from './contracts'
import { analyzeWecirDevDependencies, type WecirDevDependencyInput } from './dependency-analysis'
import { WecirDevDependencyAnalysisSchema } from './schemas'

const scope = { owner: 'acme', repository: 'app' }
const item = (
  number: number,
  values: Partial<WecirDevDependencyInput> = {}
): WecirDevDependencyInput => ({ number, title: `Issue ${number}`, ...values })

describe('Wecir Dev dependency analysis', () => {
  it('parses title, body, comments, labels, and cross-references', () => {
    const result = analyzeWecirDevDependencies(
      [
        item(1, {
          title: 'depends on #2',
          body: 'blocks #3',
          comments: ['blocked by #4'],
          references: [{ number: 2, owner: 'acme', repository: 'app' }]
        }),
        item(2),
        item(3),
        item(4)
      ],
      scope
    )
    const byNumber = new Map(result.map((entry) => [entry.issueNumber, entry]))
    expect(byNumber.get(1)?.dependsOn).toEqual([2, 4])
    expect(byNumber.get(1)?.blocks).toEqual([3])
    expect(byNumber.get(1)?.relationSources).toEqual(
      expect.arrayContaining([
        { kind: 'explicit_text', relation: 'blocked_by', targetNumber: 2, text: 'depends on #2' },
        { kind: 'cross_reference', relation: 'blocked_by', targetNumber: 2, text: '#2' },
        { kind: 'explicit_text', relation: 'blocked_by', targetNumber: 4, text: 'blocked by #4' }
      ])
    )
    expect(byNumber.get(2)?.relationSources).toContainEqual({
      kind: 'cross_reference',
      relation: 'blocks',
      targetNumber: 1,
      text: '#2'
    })
  })

  it('supports labelled references and filters missing or foreign nodes', () => {
    const result = analyzeWecirDevDependencies(
      [
        item(1, { labels: ['depends-on: #2', 'blocked'], body: 'depends on #99' }),
        item(2),
        item(3, { labels: ['blocker: #2'] })
      ],
      scope
    )
    expect(result.find((entry) => entry.issueNumber === 1)?.dependsOn).toEqual([2])
    expect(result.find((entry) => entry.issueNumber === 3)?.dependsOn).toEqual([])
  })

  it('computes stable levels, dependent counts, and execution order', () => {
    const input = [item(3, { body: 'depends on #2' }), item(1), item(2, { body: 'depends on #1' })]
    const result = analyzeWecirDevDependencies(input)
    const byNumber = new Map(result.map((entry) => [entry.issueNumber, entry]))
    expect([...byNumber.values()].map((entry) => entry.topoLevel)).toEqual([0, 1, 2])
    expect(byNumber.get(1)?.blockedCount).toBe(1)
    expect(byNumber.get(1)?.executableOrder).toEqual([1, 2, 3])
    expect(analyzeWecirDevDependencies(input.toReversed())).toEqual(result)
  })

  it('marks cycles and excludes cyclic dependents from execution', () => {
    const result = analyzeWecirDevDependencies([
      item(10, { body: 'depends on #11' }),
      item(11, { body: 'depends on #10' }),
      item(12, { body: 'depends on #10' })
    ])
    expect(result.every((entry) => entry.cycleDetected)).toBe(true)
    expect(result[0].cycleNodes).toEqual([10, 11])
    expect(result[0].executableOrder).toEqual([])
  })

  it('returns strict JSON-safe analysis results', () => {
    const result = analyzeWecirDevDependencies([item(1)])[0]
    expect(WecirDevDependencyAnalysisSchema.safeParse(result).success).toBe(true)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(
      WecirDevDependencyAnalysisSchema.safeParse({
        ...result,
        schemaVersion: WECIR_DEV_SCHEMA_VERSION,
        unknown: true
      }).success
    ).toBe(false)
  })
})
