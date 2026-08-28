import { z } from 'zod'
import { CardTierSchema } from './card-tier-assessment'

export const CardStartRequestSchema = z
  .object({
    issue: z.number().int().positive(),
    card: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+){1,63}$/),
    tier: CardTierSchema,
    repoId: z.string().min(1)
  })
  .strict()

export type CardStartRequest = z.infer<typeof CardStartRequestSchema>

const CardStartSuccessSchema = z
  .object({
    schemaVersion: z.literal(1),
    ok: z.literal(true),
    exitCode: z.literal(0),
    controllerPtyId: z.string().min(1),
    worktreeId: z.string().min(1),
    worktreePath: z.string().min(1),
    branch: z.string().min(1),
    workerAgent: z.string().min(1),
    issue: z.number().int().positive(),
    card: z.string().min(1),
    tier: CardTierSchema
  })
  .strict()

const CardStartFailureSchema = z
  .object({
    schemaVersion: z.literal(1),
    ok: z.literal(false),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    error: z
      .object({ code: z.string().min(1), message: z.string().min(1), retryable: z.boolean() })
      .strict()
  })
  .strict()

export const CardStartResultSchema = z.union([CardStartSuccessSchema, CardStartFailureSchema])

export type CardStartResult = z.infer<typeof CardStartResultSchema>
