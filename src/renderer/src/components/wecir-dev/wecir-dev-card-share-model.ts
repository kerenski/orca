import { z } from 'zod'
import { WECIR_DEV_SCHEMA_VERSION } from '../../../../shared/wecir-dev/contracts'

export type WecirDevCardShare = {
  schemaVersion: typeof WECIR_DEV_SCHEMA_VERSION
  shareId: string
  cardId: string
  recipient: string
  sharedAt: string
}

export const WecirDevCardShareSchema: z.ZodType<WecirDevCardShare> = z
  .object({
    schemaVersion: z.literal(WECIR_DEV_SCHEMA_VERSION),
    shareId: z.string().min(1).max(128),
    cardId: z.string().min(1).max(128),
    recipient: z.string().min(1).max(320),
    sharedAt: z.iso.datetime({ offset: true })
  })
  .strict()
