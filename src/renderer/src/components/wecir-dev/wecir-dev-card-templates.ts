import { WECIR_DEV_SCHEMA_VERSION } from '../../../../shared/wecir-dev/contracts'
import {
  WecirDevCardTemplateSchema,
  type WecirDevCardTemplate,
  type WecirDevCardTemplateDraft
} from './wecir-dev-card-template-model'
import { createWecirDevCardDataId, updateWecirDevCardSnapshot } from './wecir-dev-card-storage'

export {
  WecirDevCardTemplateSchema,
  type WecirDevCardTemplate,
  type WecirDevCardTemplateDraft
} from './wecir-dev-card-template-model'

export function saveWecirDevCardTemplate(
  draft: WecirDevCardTemplateDraft,
  templateId?: string
): WecirDevCardTemplate {
  const now = new Date().toISOString()
  let saved: WecirDevCardTemplate | null = null
  updateWecirDevCardSnapshot((current) => {
    const existing = templateId
      ? current.templates.find((template) => template.templateId === templateId)
      : undefined
    saved = WecirDevCardTemplateSchema.parse({
      ...draft,
      schemaVersion: WECIR_DEV_SCHEMA_VERSION,
      templateId: existing?.templateId ?? createWecirDevCardDataId('template'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    })
    return {
      ...current,
      templates: existing
        ? current.templates.map((template) =>
            template.templateId === existing.templateId ? saved! : template
          )
        : [saved, ...current.templates]
    }
  })
  return saved!
}

export function deleteWecirDevCardTemplate(templateId: string): void {
  updateWecirDevCardSnapshot((current) => ({
    ...current,
    templates: current.templates.filter((template) => template.templateId !== templateId)
  }))
}
