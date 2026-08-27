export type {
  WecirDevAnalyzeCardsArgs,
  WecirDevAnalyzeCardsResult,
  WecirDevGetCardStatusesArgs,
  WecirDevGetCardStatusesResult,
  WecirDevOperationRequest,
  WecirDevOperationResponse,
  WecirDevSendControllerCommandArgs,
  WecirDevSendControllerCommandResult,
  WecirDevStartCardArgs,
  WecirDevStartCardResult,
  WecirDevStartCardsBatchArgs,
  WecirDevStartCardsBatchItem,
  WecirDevStartCardsBatchResult
} from '../../shared/wecir-dev/operations'

import type {
  WecirDevAnalysisResult,
  WecirDevStartCardSuccess
} from '../../shared/wecir-dev/contracts'
import type { WecirDevPriorityConfig } from '../../shared/wecir-dev/card-priority-analysis'

export type WecirDevModelAssist = (input: {
  number: number
  title: string
  ruleAnalysis: WecirDevAnalysisResult
}) => Promise<Pick<WecirDevAnalysisResult, 'explanation' | 'confidence'> | undefined>

export type CardRunnerResult = WecirDevStartCardSuccess

export type CardRunner = (args: {
  issueNumber: number
  card: string
  tier: 'simple' | 'medium' | 'complex'
  cwd?: string
  force?: boolean
  signal?: AbortSignal
}) => Promise<CardRunnerResult>

export type WecirDevServiceDependencies = {
  runCard?: CardRunner
  now?: () => string
  modelAssist?: WecirDevModelAssist
  priorityConfig?: WecirDevPriorityConfig
}
