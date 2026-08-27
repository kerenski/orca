import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  WECIR_DEV_SCHEMA_VERSION,
  isKnownWecirDevStatus,
  isValidWecirDevStatusTransition
} from './contracts'
import {
  WecirDevCardRecordSchema,
  WecirDevIssueReferenceSchema,
  WecirDevStatusTransitionSchema,
  WecirDevResponseSchema,
  WecirDevErrorSchema
} from './schemas'

const baseCard = {
  schemaVersion: WECIR_DEV_SCHEMA_VERSION,
  cardId: 'card-m1-01',
  name: 'm1-01',
  repository: { repositoryId: 'repo-1', path: '/tmp/orca', executionHost: 'local' },
  reference: { kind: 'issue', number: 61, owner: 'kerenski', repository: 'orca' },
  priority: 'high',
  dependencies: [],
  status: 'queued',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z'
} as const

describe('Wecir Dev schemas', () => {
  it('accepts the V1 success card fixture shape', () => {
    expect(WecirDevCardRecordSchema.safeParse(baseCard).success).toBe(true)
  })

  it('rejects dangerous unknown fields, invalid issue numbers, and invalid names', () => {
    expect(WecirDevCardRecordSchema.safeParse({ ...baseCard, token: 'secret' }).success).toBe(false)
    expect(
      WecirDevCardRecordSchema.safeParse({
        ...baseCard,
        reference: { ...baseCard.reference, number: 0 }
      }).success
    ).toBe(false)
    expect(WecirDevCardRecordSchema.safeParse({ ...baseCard, name: 'M1 01' }).success).toBe(false)
  })

  it('accepts an old payload that omits additive optional fields', () => {
    expect(WecirDevIssueReferenceSchema.parse(baseCard.reference)).toEqual(baseCard.reference)
    expect(WecirDevCardRecordSchema.parse(baseCard)).toMatchObject({ cardId: 'card-m1-01' })
  })

  it('parses the success, failure, and legacy JSON fixtures', () => {
    const fixture = (name: string) =>
      JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf8')) as Record<
        string,
        unknown
      >
    expect(WecirDevCardRecordSchema.safeParse(fixture('success-card.v1.json')).success).toBe(true)
    expect(
      WecirDevResponseSchema(WecirDevCardRecordSchema).safeParse(
        fixture('failure-response.v1.json')
      ).success
    ).toBe(true)
    expect(WecirDevCardRecordSchema.safeParse(fixture('legacy-card.v1.json')).success).toBe(true)
  })

  it('requires explicit versioned response data or an error', () => {
    const responseSchema = WecirDevResponseSchema(z.number())
    expect(
      responseSchema.safeParse({ schemaVersion: 1, requestId: 'req-1', ok: true, data: 0 }).success
    ).toBe(true)
    expect(
      responseSchema.safeParse({ schemaVersion: 1, requestId: 'req-1', ok: true }).success
    ).toBe(false)
    expect(
      WecirDevResponseSchema(WecirDevErrorSchema).safeParse({
        schemaVersion: 1,
        requestId: 'req-1',
        ok: false,
        error: { code: 'unknown', message: 'x', retryable: false }
      }).success
    ).toBe(true)
  })

  it('rejects invalid status transitions and unknown states', () => {
    expect(isValidWecirDevStatusTransition('queued', 'starting')).toBe(true)
    expect(isValidWecirDevStatusTransition('queued', 'completed')).toBe(false)
    expect(
      WecirDevStatusTransitionSchema.safeParse({
        schemaVersion: 1,
        cardId: 'card-m1-01',
        from: 'queued',
        to: 'completed'
      }).success
    ).toBe(false)
    expect(isKnownWecirDevStatus('controller_ready')).toBe(true)
    expect(isKnownWecirDevStatus('succeeded')).toBe(false)
  })
})
