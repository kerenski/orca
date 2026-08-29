import { z } from 'zod'

export const CardTierSchema = z.enum(['simple', 'medium', 'complex'])
export type CardTier = z.infer<typeof CardTierSchema>

export type CardTierAssessmentInput = {
  title: string
  body?: string | null
  labels?: readonly string[]
}

export type CardTierAssessment = {
  tier: CardTier
  reasons: string[]
  confidence: number
}

const COMPLEX_SIGNALS =
  /\b(rbac|permission|security|migration|state machine|distributed|architecture|multi[- ]module|跨模块|权限|状态机|迁移)\b/i
const MEDIUM_SIGNALS =
  /\b(api|backend|frontend|full[- ]stack|integration|跨|联动|module|component|2[-–]3 files)\b/i
const SIMPLE_SIGNALS =
  /\b(css|style|styling|copy|typo|single[- ]file|single[- ]page|纯样式|单文件|单页面)\b/i

export function assessCardTier(input: CardTierAssessmentInput): CardTierAssessment {
  const text = `${input.title}\n${input.body ?? ''}\n${(input.labels ?? []).join(' ')}`
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

  return { tier, reasons, confidence }
}
