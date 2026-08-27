import { z } from 'zod'
import type { WecirDevPage } from './contracts'

const SchemaVersion = z.literal(1)

export const WecirDevPageRequestSchema = z
  .object({
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(200).optional(),
    cursor: z.string().min(1).max(512).optional()
  })
  .strict()
  .refine((value) => !(value.page && value.cursor), {
    message: 'Use page or cursor, not both'
  })

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
