import type {
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
  WecirDevStartCardsBatchResult
} from '../../shared/wecir-dev/operations'
export type WecirDevApi = {
  analyzeCards: (
    args: WecirDevOperationRequest<WecirDevAnalyzeCardsArgs>
  ) => Promise<WecirDevOperationResponse<WecirDevAnalyzeCardsResult>>
  startCard: (
    args: WecirDevOperationRequest<WecirDevStartCardArgs>
  ) => Promise<WecirDevOperationResponse<WecirDevStartCardResult>>
  startCardsBatch: (
    args: WecirDevOperationRequest<WecirDevStartCardsBatchArgs>
  ) => Promise<WecirDevOperationResponse<WecirDevStartCardsBatchResult>>
  getCardStatuses: (
    args: WecirDevOperationRequest<WecirDevGetCardStatusesArgs>
  ) => Promise<WecirDevOperationResponse<WecirDevGetCardStatusesResult>>
  sendControllerCommand: (
    args: WecirDevOperationRequest<WecirDevSendControllerCommandArgs>
  ) => Promise<WecirDevOperationResponse<WecirDevSendControllerCommandResult>>
}
