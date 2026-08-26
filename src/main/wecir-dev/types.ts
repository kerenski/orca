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

import type { WecirDevStartCardSuccess } from '../../shared/wecir-dev/contracts'

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
}
