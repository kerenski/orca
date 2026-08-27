import type {
  WecirDevAnalysisResult,
  WecirDevCardRecord,
  WecirDevRepositorySelection
} from '../../shared/wecir-dev/contracts'
import {
  calculateWecirDevPriority,
  sortWecirDevAnalyses,
  type WecirDevPriorityConfig
} from '../../shared/wecir-dev/card-priority-analysis'
import type { WecirDevDependencyAnalysis } from '../../shared/wecir-dev/contracts'
import type { WecirDevGitHubItem } from '../../shared/wecir-dev/github-data-contracts'
import type { WecirDevModelAssist } from './types'
import { uniqueCardName } from './analysis-support'
import { cardNameForIssue, createCardRecord } from './service-support'

type AnalysisCardPrioritiesInput = {
  items: WecirDevGitHubItem[]
  repository: WecirDevRepositorySelection
  owner: string
  repositoryName: string
  analyzedAt: string
  now: () => string
  usedNames: Set<string>
  failedDetails: Set<number>
  dependencyByIssue: Map<number, WecirDevDependencyAnalysis>
  modelAssist?: WecirDevModelAssist
  priorityConfig?: WecirDevPriorityConfig
}

type AnalyzedCard = {
  card: WecirDevCardRecord
  priority: ReturnType<typeof calculateWecirDevPriority>
  title: string
  updatedAt: string
}

export async function buildAnalysisCards(
  input: AnalysisCardPrioritiesInput
): Promise<WecirDevCardRecord[]> {
  const analyzedCards = await Promise.all(
    input.items.map(async (item): Promise<AnalyzedCard> => {
      const dependencyAnalysis = input.dependencyByIssue.get(item.number)
      const dependencies =
        dependencyAnalysis?.dependsOn.map((number) => ({
          relation: 'blocked_by' as const,
          targetCardId: `${input.repository.repositoryId}:${number}`
        })) ?? []
      const referencedIssueCount = new Set(
        (dependencyAnalysis?.relationSources ?? [])
          .filter((source) => source.kind === 'cross_reference')
          .map((source) => source.targetNumber)
      ).size
      const priority = calculateWecirDevPriority(
        {
          number: item.number,
          title: item.title,
          labels: item.labels,
          milestone: item.milestone,
          draft: item.draft,
          updatedAt: item.updatedAt,
          dependency: dependencyAnalysis,
          impactedIssueCount: Math.max(
            item.references.length,
            referencedIssueCount,
            dependencyAnalysis?.dependsOn.length ?? 0
          ),
          now: input.analyzedAt
        },
        input.priorityConfig
      )
      const card = createCardRecord(
        { ...input.repository, owner: input.owner, name: input.repositoryName },
        item.number,
        uniqueCardName(cardNameForIssue(item.number, item.title), input.usedNames),
        item.type === 'pr' ? 'pull_request' : 'issue',
        input.now,
        item.labels
      )
      const riskFlags = [
        ...(input.failedDetails.has(item.number) ? ['github_detail_unavailable'] : []),
        ...(dependencyAnalysis?.cycleDetected ? ['dependency_cycle_detected'] : [])
      ]
      card.dependencies = dependencies
      const ruleAnalysis: WecirDevAnalysisResult = {
        summary: `Deterministic GitHub analysis for ${item.type === 'pr' ? 'PR' : 'issue'} #${item.number}: ${item.title}`,
        suggestedPriority: priority.suggestedPriority,
        dependencies,
        riskFlags,
        acceptanceCriteria: ['Implementation satisfies the issue or pull request requirements'],
        generatedAt: input.analyzedAt,
        score: priority.score,
        scoreDetails: priority.scoreDetails,
        priorityBand: priority.priorityBand,
        suggestedTier: priority.suggestedTier,
        explanation: priority.explanation,
        confidence: priority.confidence,
        ...(priority.cycleWarning ? { cycleWarning: priority.cycleWarning } : {})
      }
      let analysis = ruleAnalysis
      if (input.modelAssist) {
        try {
          const model = await input.modelAssist({
            number: item.number,
            title: item.title,
            ruleAnalysis
          })
          if (model?.explanation || model?.confidence !== undefined) {
            analysis = { ...ruleAnalysis, ...model }
          }
        } catch {
          // Rule analysis is the safe fallback.
        }
      }
      card.analysis = analysis
      return { card, priority, title: item.title, updatedAt: item.updatedAt }
    })
  )

  return sortWecirDevAnalyses(
    analyzedCards.map(({ card, priority, title, updatedAt }) => ({
      ...priority,
      number: card.reference.number,
      title,
      updatedAt,
      dependency: input.dependencyByIssue.get(card.reference.number)
    }))
  ).map((sorted) => analyzedCards.find(({ card }) => card.reference.number === sorted.number)!.card)
}
