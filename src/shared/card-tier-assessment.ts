import { z } from 'zod'

export const CardTierSchema = z.enum(['simple', 'medium', 'complex'])
export type CardTier = z.infer<typeof CardTierSchema>

export type CardTierAssessmentInput = {
  title: string
  body?: string | null
  labels?: readonly string[]
}

export type CardTierAssessment = {
  cardId: string | null
  tier: CardTier
  reasons: string[]
  confidence: number
}

const CARD_ID_PREFIX = /^\s*([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)\b/
const COMPLEX_SIGNALS =
  /\b(rbac|permission|security|migration|state machine|distributed|architecture|multi[- ]module|跨模块|权限|状态机|迁移)\b/i
const MEDIUM_SIGNALS =
  /\b(api|backend|frontend|full[- ]stack|integration|跨|联动|module|component|2[-–]3 files)\b/i
const SIMPLE_SIGNALS =
  /\b(css|style|styling|copy|typo|single[- ]file|single[- ]page|纯样式|单文件|单页面)\b/i

export function normalizeCardId(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const normalized = value.trim().toLowerCase()
  return /^[a-z0-9]+(?:-[a-z0-9]+){1,63}$/.test(normalized) ? normalized : null
}

export function assessCardTier(input: CardTierAssessmentInput): CardTierAssessment {
  const text = `${input.title}\n${input.body ?? ''}\n${(input.labels ?? []).join(' ')}`
  const match = input.title.match(CARD_ID_PREFIX)
  const cardId = normalizeCardId(match?.[1])
  const reasons: string[] = []
  let tier: CardTier = 'simple'
  let confidence = 0.35

  if (COMPLEX_SIGNALS.test(text)) {
    tier = 'complex'
    confidence = 0.9
    reasons.push('内容包含多模块、权限、迁移或状态机等高复杂度信号。')
  } else if (MEDIUM_SIGNALS.test(text)) {
    tier = 'medium'
    confidence = 0.75
    reasons.push('内容包含跨模块、前后端联动或新增模块信号。')
  } else if (SIMPLE_SIGNALS.test(text)) {
    reasons.push('内容符合单文件、单页面或纯样式小改特征。')
    confidence = 0.8
  } else {
    reasons.push('可用信息不足，按规则保守选择 simple。')
  }

  if (!cardId) {
    confidence = Math.min(confidence, 0.45)
    reasons.push('标题开头未解析出合法 card id。')
  }
  return { cardId, tier, reasons, confidence }
}
