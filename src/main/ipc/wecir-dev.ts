import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { Store } from '../persistence'
import {
  WECIR_DEV_SCHEMA_VERSION,
  type WecirDevError,
  type WecirDevResponse
} from '../../shared/wecir-dev/contracts'
import { WecirDevOperationSchemas } from '../../shared/wecir-dev/operations'
import { WecirDevService } from '../wecir-dev/service'
import { isTrustedUIRenderer } from './ui'

const CHANNELS = [
  'wecir-dev:analyzeCards',
  'wecir-dev:startCard',
  'wecir-dev:startCardsBatch',
  'wecir-dev:getCardStatuses',
  'wecir-dev:sendControllerCommand'
] as const

export function registerWecirDevHandlers(
  store: Store,
  service = new WecirDevService(store),
  trustedWebContentsId: number | null = null
): WecirDevService {
  for (const channel of CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle('wecir-dev:analyzeCards', (event, raw: unknown) =>
    handle(event, trustedWebContentsId, raw, WecirDevOperationSchemas.analyzeCards, (request) =>
      service.analyzeCards(request.payload)
    )
  )
  ipcMain.handle('wecir-dev:startCard', (event, raw: unknown) =>
    handle(event, trustedWebContentsId, raw, WecirDevOperationSchemas.startCard, (request) =>
      service.startCard(request.payload)
    )
  )
  ipcMain.handle('wecir-dev:startCardsBatch', (event, raw: unknown) =>
    handle(event, trustedWebContentsId, raw, WecirDevOperationSchemas.startCardsBatch, (request) =>
      service.startCardsBatch(request.payload)
    )
  )
  ipcMain.handle('wecir-dev:getCardStatuses', (event, raw: unknown) =>
    handle(event, trustedWebContentsId, raw, WecirDevOperationSchemas.getCardStatuses, (request) =>
      service.getCardStatuses(request.payload)
    )
  )
  ipcMain.handle('wecir-dev:sendControllerCommand', (event, raw: unknown) =>
    handle(
      event,
      trustedWebContentsId,
      raw,
      WecirDevOperationSchemas.sendControllerCommand,
      (request) => service.sendControllerCommand(request.payload)
    )
  )
  return service
}

type OperationSchemas = (typeof WecirDevOperationSchemas)[keyof typeof WecirDevOperationSchemas]

type ParsedRequest = { requestId: string; payload: never }

async function handle(
  event: IpcMainInvokeEvent,
  trustedWebContentsId: number | null,
  raw: unknown,
  schemas: OperationSchemas,
  operation: (request: ParsedRequest) => unknown
): Promise<WecirDevResponse<unknown>> {
  if (
    !isTrustedUIRenderer(event.sender) ||
    (trustedWebContentsId != null && event.sender.id !== trustedWebContentsId)
  ) {
    return validatedFailure(schemas, 'invalid-request', {
      code: 'invalid_parameters',
      message: 'Untrusted Wecir Dev sender',
      retryable: false
    })
  }
  const parsed = schemas.request.safeParse(raw)
  const requestId = parsed.success ? parsed.data.requestId : 'invalid-request'
  if (!parsed.success) {
    return validatedFailure(schemas, requestId, {
      code: 'invalid_parameters',
      message: 'Invalid Wecir Dev request',
      retryable: false
    })
  }
  try {
    const response = success(requestId, await operation(parsed.data as unknown as ParsedRequest))
    if (schemas.response.safeParse(response).success) {
      return response
    }
    return validatedFailure(schemas, requestId, {
      code: 'invalid_script_output',
      message: 'Wecir Dev service returned an invalid response',
      retryable: false
    })
  } catch (error) {
    return validatedFailure(
      schemas,
      requestId,
      (error as { cardError?: WecirDevError }).cardError ?? {
        code: 'unknown',
        message: 'Wecir Dev operation failed',
        retryable: true
      }
    )
  }
}

function success(requestId: string, data: unknown): WecirDevResponse<unknown> {
  return { schemaVersion: WECIR_DEV_SCHEMA_VERSION, requestId, ok: true, data }
}

function failure(requestId: string, error: WecirDevError): WecirDevResponse<unknown> {
  return { schemaVersion: WECIR_DEV_SCHEMA_VERSION, requestId, ok: false, error }
}

function validatedFailure(
  schemas: OperationSchemas,
  requestId: string,
  error: WecirDevError
): WecirDevResponse<unknown> {
  const response = failure(requestId, error)
  if (schemas.response.safeParse(response).success) {
    return response
  }
  return failure(requestId, {
    code: 'unknown',
    message: 'Wecir Dev operation failed',
    retryable: true
  })
}
