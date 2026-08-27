import { z } from 'zod'
import type {
  WecirDevAnalysisScoreDetail,
  WecirDevDependencyAnalysis,
  WecirDevPriority
} from './contracts'

export type WecirDevPriorityConfig = {
  staleAfterDays?: number
  stalePointsPerDay?: number
  staleMaxPoints?: number
}

export const WecirDevPriorityConfigSchema = z
  .object({
    staleAfterDays: z.number().finite().nonnegative().optional(),
    stalePointsPerDay: z.number().finite().nonnegative().optional(),
    staleMaxPoints: z.number().finite().nonnegative().optional()
  })
  .strict()

export type WecirDevPriorityInput = {
  number: number
  title: string
  labels?: string[]
  milestone?: string | null
  draft?: boolean
  updatedAt: string
  dependency?: Pick<
    WecirDevDependencyAnalysis,
    'dependsOn' | 'blockedCount' | 'cycleDetected' | 'topoLevel' | 'cycleNodes'
  >
  impactedIssueCount?: number
  now?: string
}

export type WecirDevPriorityResult = {
  score: number
  scoreDetails: WecirDevAnalysisScoreDetail[]
  priorityBand: 'P0' | 'P1' | 'P2' | 'P3'
  suggestedPriority: WecirDevPriority
  suggestedTier: 'simple' | 'medium' | 'complex'
  explanation: string
  confidence: number
  cycleWarning?: string
}

const DEFAULT_CONFIG: Required<WecirDevPriorityConfig> = {
  staleAfterDays: 30,
  stalePointsPerDay: 1,
  staleMaxPoints: 20
}

const SEVERITY_POINTS = {
  low: 10,
  medium: 40,
  high: 70,
  critical: 100,
  blocker: 100
} as const

function normalizeNonNegative(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, value)
}

function add(
  details: WecirDevAnalysisScoreDetail[],
  rule: string,
  points: number,
  explanation: string
) {
  if (points !== 0) {
    details.push({ rule, points, explanation })
  }
}

export function calculateWecirDevPriority(
  input: WecirDevPriorityInput,
  config: WecirDevPriorityConfig = {}
): WecirDevPriorityResult {
  const options = {
    staleAfterDays: normalizeNonNegative(config.staleAfterDays, DEFAULT_CONFIG.staleAfterDays),
    stalePointsPerDay: normalizeNonNegative(
      config.stalePointsPerDay,
      DEFAULT_CONFIG.stalePointsPerDay
    ),
    staleMaxPoints: normalizeNonNegative(config.staleMaxPoints, DEFAULT_CONFIG.staleMaxPoints)
  }
  const labels = (input.labels ?? []).map((label) => label.toLowerCase())
  const details: WecirDevAnalysisScoreDetail[] = []
  const severity = labels
    .map((label) => label.match(/(?:^|[:=_ -])(critical|blocker|high|medium|low)$/)?.[1])
    .filter((value): value is keyof typeof SEVERITY_POINTS => value !== undefined)
    .sort((a, b) => SEVERITY_POINTS[b] - SEVERITY_POINTS[a])[0]
  const severityPoints = severity === undefined ? 0 : SEVERITY_POINTS[severity]
  if (severity) {
    add(details, severity, severityPoints, `${severity} severity`)
  }
  if (labels.some((label) => /(?:^|[:=_ -])(bug|security|regression)$/.test(label))) {
    add(details, 'impact-risk', 30, 'bug, security, or regression risk')
  }
  if ((input.impactedIssueCount ?? 0) > 1) {
    add(details, 'multiple-impact', 20, 'impacts multiple issues')
  }
  if ((input.dependency?.blockedCount ?? 0) > 1) {
    add(details, 'multiple-dependents', 20, 'multiple tasks depend on this task')
  }
  if (input.milestone) {
    add(details, 'milestone', 15, 'has a milestone')
  }
  if ((input.dependency?.dependsOn.length ?? 0) > 0) {
    add(details, 'blocked', -20, 'depends on another task')
  }
  if (input.draft || labels.some((label) => /(?:^|[:=_ -])experimental$/.test(label))) {
    add(details, 'draft-experimental', -10, 'draft or experimental work')
  }

  const now = Date.parse(input.now ?? new Date().toISOString())
  const updated = Date.parse(input.updatedAt)
  const staleDays =
    Number.isFinite(now) && Number.isFinite(updated)
      ? Math.max(0, (now - updated) / 86_400_000 - options.staleAfterDays)
      : 0
  const stalePoints = Math.min(
    options.staleMaxPoints,
    Math.floor(staleDays * options.stalePointsPerDay)
  )
  if (stalePoints > 0) {
    add(
      details,
      'stale',
      stalePoints,
      `not updated for ${Math.floor(staleDays + options.staleAfterDays)} days`
    )
  }

  const score = details.reduce((total, detail) => total + detail.points, 0)
  const priorityBand = score >= 100 ? 'P0' : score >= 70 ? 'P1' : score >= 40 ? 'P2' : 'P3'
  const suggestedPriority: WecirDevPriority =
    priorityBand === 'P0'
      ? 'critical'
      : priorityBand === 'P1'
        ? 'high'
        : priorityBand === 'P2'
          ? 'normal'
          : 'low'
  const suggestedTier =
    score >= 100 || (input.dependency?.dependsOn.length ?? 0) > 1
      ? 'complex'
      : score >= 40
        ? 'medium'
        : 'simple'
  const cycleWarning = input.dependency?.cycleDetected
    ? `Dependency cycle detected: #${(input.dependency.cycleNodes ?? []).join(', #')}`
    : undefined
  return {
    score,
    scoreDetails: details,
    priorityBand,
    suggestedPriority,
    suggestedTier,
    explanation: details.length
      ? details
          .map(
            (detail) => `${detail.explanation} (${detail.points >= 0 ? '+' : ''}${detail.points})`
          )
          .join('; ')
      : 'No matching prioritization rules',
    confidence: input.dependency?.cycleDetected ? 0.7 : 0.9,
    ...(cycleWarning ? { cycleWarning } : {})
  }
}

export type WecirDevSortableAnalysis = WecirDevPriorityInput & WecirDevPriorityResult

export function sortWecirDevAnalyses(
  items: WecirDevSortableAnalysis[]
): WecirDevSortableAnalysis[] {
  const bandOrder = { P0: 0, P1: 1, P2: 2, P3: 3 }
  const compareUpdatedAt = (a: string, b: string): number => {
    const aTime = Date.parse(a)
    const bTime = Date.parse(b)
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
      return bTime - aTime
    }
    if (Number.isFinite(aTime)) {
      return -1
    }
    if (Number.isFinite(bTime)) {
      return 1
    }
    return 0
  }
  return [...items].sort(
    (a, b) =>
      (a.dependency?.topoLevel ?? 0) - (b.dependency?.topoLevel ?? 0) ||
      bandOrder[a.priorityBand] - bandOrder[b.priorityBand] ||
      (b.dependency?.blockedCount ?? 0) - (a.dependency?.blockedCount ?? 0) ||
      compareUpdatedAt(a.updatedAt, b.updatedAt) ||
      a.number - b.number
  )
}
