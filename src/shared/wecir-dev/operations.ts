import { z } from 'zod'
import type {
  WecirDevCardRecord,
  WecirDevControllerInstruction,
  WecirDevError,
  WecirDevPage,
  WecirDevRequest,
  WecirDevResponse,
  WecirDevRepositorySelection,
  WecirDevStatus
} from './contracts'
import {
  WecirDevCardRecordSchema,
  WecirDevErrorSchema,
  WecirDevGetCardStatusesPayloadSchema,
  WecirDevPageSchema,
  WecirDevRequestSchema,
  WecirDevResponseSchema,
  WecirDevAnalyzeCardsPayloadSchema,
  WecirDevStartCardPayloadSchema,
  WecirDevStartCardsBatchPayloadSchema,
  WecirDevSendControllerCommandPayloadSchema
} from './schemas'

export type WecirDevAnalyzeCardsArgs = {
  repository: WecirDevRepositorySelection
  issueNumbers?: number[]
  query?: string
}
export type WecirDevAnalyzeCardsResult = { cards: WecirDevCardRecord[]; analyzedAt: string }
export type WecirDevStartCardArgs = {
  repository: WecirDevRepositorySelection
  issueNumber: number
  card: string
  tier?: 'simple' | 'medium' | 'complex'
  force?: boolean
}
export type WecirDevStartCardResult = { card: WecirDevCardRecord }
export type WecirDevStartCardsBatchArgs = {
  repository: WecirDevRepositorySelection
  cards: Omit<WecirDevStartCardArgs, 'repository'>[]
}
export type WecirDevStartCardsBatchItem =
  | { issueNumber: number; ok: true; card: WecirDevCardRecord }
  | { issueNumber: number; ok: false; error: WecirDevError }
export type WecirDevStartCardsBatchResult = {
  items: WecirDevStartCardsBatchItem[]
  stoppedOnFailure: boolean
}
export type WecirDevGetCardStatusesArgs = { repositoryId: string; cardIds?: string[] }
export type WecirDevGetCardStatusesResult = WecirDevPage<WecirDevCardRecord>
export type WecirDevSendControllerCommandArgs = {
  repositoryId: string
  cardId: string
  command: WecirDevControllerInstruction['command']
  expectedStatus?: WecirDevStatus
  reason?: string
}
export type WecirDevSendControllerCommandResult = {
  card: WecirDevCardRecord
  accepted: boolean
}
export type WecirDevOperationRequest<T> = WecirDevRequest<T>
export type WecirDevOperationResponse<T> = WecirDevResponse<T>

export const WecirDevOperationSchemas = {
  analyzeCards: {
    request: WecirDevRequestSchema(WecirDevAnalyzeCardsPayloadSchema),
    response: WecirDevResponseSchema(
      z
        .object({
          cards: z.array(WecirDevCardRecordSchema),
          analyzedAt: z.iso.datetime({ offset: true })
        })
        .strict()
    )
  },
  startCard: {
    request: WecirDevRequestSchema(WecirDevStartCardPayloadSchema),
    response: WecirDevResponseSchema(z.object({ card: WecirDevCardRecordSchema }).strict())
  },
  startCardsBatch: {
    request: WecirDevRequestSchema(WecirDevStartCardsBatchPayloadSchema),
    response: WecirDevResponseSchema(
      z
        .object({
          items: z.array(
            z.union([
              z
                .object({
                  issueNumber: z.number().int().positive(),
                  ok: z.literal(true),
                  card: WecirDevCardRecordSchema
                })
                .strict(),
              z
                .object({
                  issueNumber: z.number().int().positive(),
                  ok: z.literal(false),
                  error: WecirDevErrorSchema
                })
                .strict()
            ])
          ),
          stoppedOnFailure: z.boolean()
        })
        .strict()
    )
  },
  getCardStatuses: {
    request: WecirDevRequestSchema(WecirDevGetCardStatusesPayloadSchema),
    response: WecirDevResponseSchema(WecirDevPageSchema(WecirDevCardRecordSchema))
  },
  sendControllerCommand: {
    request: WecirDevRequestSchema(WecirDevSendControllerCommandPayloadSchema),
    response: WecirDevResponseSchema(
      z
        .object({
          card: WecirDevCardRecordSchema,
          accepted: z.boolean()
        })
        .strict()
    )
  }
} as const

export type WecirDevOperationName = keyof typeof WecirDevOperationSchemas
