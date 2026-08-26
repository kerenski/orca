import { z } from 'zod'
import {
  WECIR_DEV_PRIORITIES,
  WECIR_DEV_SCHEMA_VERSION,
  type WecirDevIssueReference,
  type WecirDevPriority
} from '../../../../shared/wecir-dev/contracts'
import { WecirDevCardNameSchema } from '../../../../shared/wecir-dev/schemas'

export type WecirDevCardTemplate = {
  schemaVersion: typeof WECIR_DEV_SCHEMA_VERSION
  templateId: string
  name: string
  cardName: string
  repositoryId?: string
  referenceKind: WecirDevIssueReference['kind']
  priority: WecirDevPriority
  owner?: string
  repository?: string
  createdAt: string
  updatedAt: string
}

export type WecirDevCardTemplateDraft = Omit<
  WecirDevCardTemplate,
  'schemaVersion' | 'templateId' | 'createdAt' | 'updatedAt'
>

export const WecirDevCardTemplateSchema: z.ZodType<WecirDevCardTemplate> = z
  .object({
    schemaVersion: z.literal(WECIR_DEV_SCHEMA_VERSION),
    templateId: z.string().min(1).max(128),
    name: z.string().min(1).max(100),
    cardName: WecirDevCardNameSchema,
    repositoryId: z.string().min(1).max(128).optional(),
    referenceKind: z.enum(['issue', 'pull_request']),
    priority: z.enum(WECIR_DEV_PRIORITIES),
    owner: z.string().min(1).max(100).optional(),
    repository: z.string().min(1).max(100).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true })
  })
  .strict()
