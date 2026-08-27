import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, removeHandlerMock, trustedMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  trustedMock: vi.fn(() => true)
}))

vi.mock('electron', () => ({ ipcMain: { handle: handleMock, removeHandler: removeHandlerMock } }))
vi.mock('./ui', () => ({ isTrustedUIRenderer: trustedMock }))
vi.mock('../wecir-dev/service', () => ({ WecirDevService: vi.fn() }))

import { registerWecirDevHandlers } from './wecir-dev'

const repository = { repositoryId: 'repo-1', path: '/repo', executionHost: 'local' as const }
const requests = {
  analyzeCards: { schemaVersion: 1, requestId: 'analyze-1', payload: { repository } },
  startCard: {
    schemaVersion: 1,
    requestId: 'start-1',
    payload: { repository, issueNumber: 1, card: 'issue-1-card' }
  },
  startCardsBatch: {
    schemaVersion: 1,
    requestId: 'batch-1',
    payload: { repository, cards: [{ issueNumber: 1, card: 'issue-1-card' }] }
  },
  getCardStatuses: {
    schemaVersion: 1,
    requestId: 'statuses-1',
    payload: { repositoryId: 'repo-1' }
  },
  sendControllerCommand: {
    schemaVersion: 1,
    requestId: 'command-1',
    payload: { repositoryId: 'repo-1', cardId: 'repo-1:1', command: 'refresh' }
  }
} as const

describe('Wecir Dev IPC', () => {
  beforeEach(() => {
    handleMock.mockReset()
    removeHandlerMock.mockReset()
    trustedMock.mockReturnValue(true)
  })

  it('registers and invokes all five service operations', async () => {
    const service = {
      analyzeCards: vi.fn(),
      startCard: vi.fn(),
      startCardsBatch: vi.fn(),
      getCardStatuses: vi.fn(),
      sendControllerCommand: vi.fn()
    }
    registerWecirDevHandlers({} as never, service as never, 7)
    expect(handleMock).toHaveBeenCalledTimes(5)
    const sender = { id: 7 } as Electron.WebContents
    const expected = [
      ['wecir-dev:analyzeCards', 'analyzeCards'],
      ['wecir-dev:startCard', 'startCard'],
      ['wecir-dev:startCardsBatch', 'startCardsBatch'],
      ['wecir-dev:getCardStatuses', 'getCardStatuses'],
      ['wecir-dev:sendControllerCommand', 'sendControllerCommand']
    ] as const
    for (const [channel, method] of expected) {
      const handler = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
      await handler({ sender }, requests[method])
      expect(service[method]).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects invalid envelopes before calling a service', async () => {
    const service = { analyzeCards: vi.fn() }
    registerWecirDevHandlers({} as never, service as never)
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'wecir-dev:analyzeCards'
    )?.[1]
    const response = await handler({ sender: { id: 1 } }, { schemaVersion: 1, payload: {} })
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_parameters' } })
    expect(service.analyzeCards).not.toHaveBeenCalled()
  })

  it('rejects an untrusted sender with a structured error', async () => {
    trustedMock.mockReturnValue(false)
    const service = { getCardStatuses: vi.fn() }
    registerWecirDevHandlers({} as never, service as never)
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'wecir-dev:getCardStatuses'
    )?.[1]
    const response = await handler({ sender: { id: 1 } }, requests.getCardStatuses)
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_parameters', retryable: false }
    })
    expect(service.getCardStatuses).not.toHaveBeenCalled()
  })

  it('returns invalid_script_output when a service result fails its response schema', async () => {
    const service = { startCard: vi.fn().mockResolvedValue({ invalid: true }) }
    registerWecirDevHandlers({} as never, service as never)
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'wecir-dev:startCard'
    )?.[1]
    const response = await handler({ sender: { id: 1 } }, requests.startCard)
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_script_output' } })
  })
})
