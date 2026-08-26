import { z } from 'zod'
import {
  WECIR_DEV_ERROR_CODES,
  WECIR_DEV_PRIORITIES,
  WECIR_DEV_SCHEMA_VERSION,
  WECIR_DEV_STATUSES,
  isValidWecirDevStatusTransition,
  type WecirDevAnalysisResult,
  type WecirDevCardRecord,
  type WecirDevControllerInstruction,
  type WecirDevDependencyAnalysis,
  type WecirDevDependencyRelation,
  type WecirDevError,
  type WecirDevRelationSource,
  type WecirDevIssueReference,
  type WecirDevPage,
  type WecirDevQueueItem,
  type WecirDevRepositorySelection,
  type WecirDevRequest,
  type WecirDevResponse,
  type WecirDevStartCardFailure,
  type WecirDevStartCardScriptResult,
  type WecirDevStartCardSuccess,
  type WecirDevStatusTransition
} from './contracts'

export const WecirDevCardNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, 'Invalid card name')
const Id = z.string().min(1).max(128)
const IsoDate = z.iso.datetime({ offset: true })
const SchemaVersion = z.literal(WECIR_DEV_SCHEMA_VERSION)

export const WecirDevSchemaVersionSchema = SchemaVersion
export const WecirDevStatusSchema = z.enum(WECIR_DEV_STATUSES)
export const WecirDevPrioritySchema = z.enum(WECIR_DEV_PRIORITIES)
export const WecirDevErrorCodeSchema = z.enum(WECIR_DEV_ERROR_CODES)

export const WecirDevRepositorySelectionSchema: z.ZodType<WecirDevRepositorySelection> = z
  .object({
    repositoryId: Id,
    path: z.string().min(1).max(4096),
    executionHost: z.literal('local'),
    provider: z.literal('github').optional(),
    owner: z.string().min(1).max(100).optional(),
    name: z.string().min(1).max(100).optional(),
    defaultBranch: z.string().min(1).max(255).optional()
  })
  .strict()

export const WecirDevIssueReferenceSchema: z.ZodType<WecirDevIssueReference> = z
  .object({
    kind: z.enum(['issue', 'pull_request']),
    number: z.number().int().positive().max(1_000_000_000),
    owner: z.string().regex(/^[A-Za-z0-9_.-]+$/),
    repository: z.string().regex(/^[A-Za-z0-9_.-]+$/),
    url: z.url().optional(),
    title: z.string().max(500).optional()
  })
  .strict()

export const WecirDevDependencyRelationSchema: z.ZodType<WecirDevDependencyRelation> = z
  .object({
    relation: z.enum(['blocks', 'blocked_by', 'related']),
    targetCardId: Id.optional(),
    targetReference: WecirDevIssueReferenceSchema.optional(),
    note: z.string().max(1000).optional()
  })
  .strict()
  .refine((value) => Boolean(value.targetCardId) !== Boolean(value.targetReference), {
    message: 'Exactly one dependency target is required'
  })

export const WecirDevRelationSourceSchema: z.ZodType<WecirDevRelationSource> = z
  .object({
    kind: z.enum(['cross_reference', 'explicit_text', 'label']),
    relation: z.enum(['blocks', 'blocked_by']),
    targetNumber: z.number().int().positive().max(1_000_000_000),
    text: z.string().max(500).optional()
  })
  .strict()

export const WecirDevDependencyAnalysisSchema: z.ZodType<WecirDevDependencyAnalysis> = z
  .object({
    schemaVersion: SchemaVersion,
    issueNumber: z.number().int().positive().max(1_000_000_000),
    dependsOn: z.array(z.number().int().positive().max(1_000_000_000)).max(128),
    blocks: z.array(z.number().int().positive().max(1_000_000_000)).max(128),
    relationSources: z.array(WecirDevRelationSourceSchema).max(128),
    topoLevel: z.number().int().nonnegative().max(1_000_000_000),
    blockedCount: z.number().int().nonnegative().max(1_000_000_000),
    cycleDetected: z.boolean(),
    cycleNodes: z.array(z.number().int().positive().max(1_000_000_000)).max(128),
    executableOrder: z.array(z.number().int().positive().max(1_000_000_000)).max(128)
  })
  .strict()

export const WecirDevAnalysisResultSchema: z.ZodType<WecirDevAnalysisResult> = z
  .object({
    summary: z.string().min(1).max(10_000),
    suggestedPriority: WecirDevPrioritySchema,
    dependencies: z.array(WecirDevDependencyRelationSchema).max(128),
    riskFlags: z.array(z.string().min(1).max(200)).max(128),
    acceptanceCriteria: z.array(z.string().min(1).max(2000)).max(128),
    generatedAt: IsoDate
  })
  .strict()

export const WecirDevErrorSchema: z.ZodType<WecirDevError> = z
  .object({
    code: WecirDevErrorCodeSchema,
    message: z.string().min(1).max(2000),
    retryable: z.boolean(),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
  })
  .strict()

export const WecirDevStartCardSuccessSchema = z
  .object({
    schemaVersion: SchemaVersion,
    ok: z.literal(true),
    controllerPtyId: Id,
    worktreeId: Id,
    worktreePath: z.string().min(1).max(4096),
    branch: z.string().min(1).max(255),
    workerAgent: z.string().min(1).max(512),
    issue: z.number().int().positive().max(1_000_000_000),
    card: WecirDevCardNameSchema,
    tier: z.enum(['simple', 'medium', 'complex'])
  })
  .strict() satisfies z.ZodType<WecirDevStartCardSuccess>

export const WecirDevStartCardFailureSchema = z
  .object({
    schemaVersion: SchemaVersion,
    ok: z.literal(false),
    error: WecirDevErrorSchema
  })
  .strict() satisfies z.ZodType<WecirDevStartCardFailure>

export const WecirDevStartCardScriptResultSchema = z.discriminatedUnion('ok', [
  WecirDevStartCardSuccessSchema,
  WecirDevStartCardFailureSchema
]) satisfies z.ZodType<WecirDevStartCardScriptResult>

export const WecirDevCardRecordSchema: z.ZodType<WecirDevCardRecord> = z
  .object({
    schemaVersion: SchemaVersion,
    cardId: Id,
    name: WecirDevCardNameSchema,
    repository: WecirDevRepositorySelectionSchema,
    reference: WecirDevIssueReferenceSchema,
    priority: WecirDevPrioritySchema,
    analysis: WecirDevAnalysisResultSchema.optional(),
    dependencies: z.array(WecirDevDependencyRelationSchema).max(128),
    status: WecirDevStatusSchema,
    createdAt: IsoDate,
    updatedAt: IsoDate,
    queuedAt: IsoDate.optional(),
    startedAt: IsoDate.optional(),
    completedAt: IsoDate.optional(),
    controllerHandle: Id.optional(),
    workerHandle: Id.optional(),
    worktreePath: z.string().min(1).max(4096).optional(),
    lastError: WecirDevErrorSchema.optional()
  })
  .strict()

export const WecirDevQueueItemSchema: z.ZodType<WecirDevQueueItem> = z
  .object({
    schemaVersion: SchemaVersion,
    queueId: Id,
    cardId: Id,
    priority: WecirDevPrioritySchema,
    enqueuedAt: IsoDate,
    attempt: z.number().int().nonnegative().max(1000),
    requestedBy: z.enum(['renderer', 'controller', 'recovery'])
  })
  .strict()

export const WecirDevControllerInstructionSchema: z.ZodType<WecirDevControllerInstruction> = z
  .object({
    schemaVersion: SchemaVersion,
    instructionId: Id,
    cardId: Id,
    command: z.enum(['start', 'stop', 'retry', 'remove', 'refresh', 'approve_merge', 'mark_stale']),
    expectedStatus: WecirDevStatusSchema.optional(),
    reason: z.string().max(2000).optional()
  })
  .strict()

export const WecirDevPageRequestSchema = z
  .object({
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(200).optional(),
    cursor: z.string().min(1).max(512).optional()
  })
  .strict()
  .refine((value) => !(value.page && value.cursor), { message: 'Use page or cursor, not both' })

export function WecirDevPageSchema<T extends z.ZodType>(itemSchema: T) {
  return z
    .object({
      schemaVersion: SchemaVersion,
      items: z.array(itemSchema),
      page: z.number().int().positive(),
      pageSize: z.number().int().positive().max(200),
      total: z.number().int().nonnegative(),
      hasNext: z.boolean(),
      nextCursor: z.string().min(1).max(512).optional()
    })
    .strict() as z.ZodType<WecirDevPage<z.infer<T>>>
}

export const WecirDevStatusTransitionSchema: z.ZodType<WecirDevStatusTransition> = z
  .object({
    schemaVersion: SchemaVersion,
    cardId: Id,
    from: WecirDevStatusSchema,
    to: WecirDevStatusSchema,
    reason: z.string().max(2000).optional()
  })
  .strict()
  .refine((value) => isValidWecirDevStatusTransition(value.from, value.to), {
    message: 'Invalid card status transition',
    path: ['to']
  })

export function WecirDevRequestSchema<T extends z.ZodType>(payloadSchema: T) {
  return z
    .object({ schemaVersion: SchemaVersion, requestId: Id, payload: payloadSchema })
    .strict() as unknown as z.ZodType<WecirDevRequest<z.infer<T>>>
}

export function WecirDevResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z
    .object({
      schemaVersion: SchemaVersion,
      requestId: Id,
      ok: z.boolean(),
      data: dataSchema.optional(),
      error: WecirDevErrorSchema.optional()
    })
    .strict()
    .refine(
      (value) =>
        value.ok === Object.hasOwn(value, 'data') && value.ok !== Object.hasOwn(value, 'error'),
      {
        message: 'Response must contain data on success or error on failure'
      }
    ) as unknown as z.ZodType<WecirDevResponse<z.infer<T>>>
}

export const WecirDevDangerousFieldNames = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'apiKey',
  'token',
  'password',
  'secret'
])

export const WecirDevAnalyzeCardsPayloadSchema = z
  .object({
    repository: WecirDevRepositorySelectionSchema,
    issueNumbers: z.array(z.number().int().positive()).max(200).optional(),
    query: z.string().max(500).optional()
  })
  .strict()
export const WecirDevStartCardPayloadSchema = z
  .object({
    repository: WecirDevRepositorySelectionSchema,
    issueNumber: z.number().int().positive(),
    card: WecirDevCardNameSchema,
    tier: z.enum(['simple', 'medium', 'complex']).optional(),
    force: z.boolean().optional()
  })
  .strict()
export const WecirDevStartCardsBatchPayloadSchema = z
  .object({
    repository: WecirDevRepositorySelectionSchema,
    cards: z.array(WecirDevStartCardPayloadSchema.omit({ repository: true })).max(50)
  })
  .strict()
export const WecirDevGetCardStatusesPayloadSchema = z
  .object({
    repositoryId: Id,
    cardIds: z.array(Id).max(200).optional()
  })
  .strict()
export const WecirDevSendControllerCommandPayloadSchema = z
  .object({
    repositoryId: Id,
    cardId: Id,
    command: z.enum(['start', 'stop', 'retry', 'remove', 'refresh', 'approve_merge', 'mark_stale']),
    expectedStatus: WecirDevStatusSchema.optional(),
    reason: z.string().max(2000).optional()
  })
  .strict()
