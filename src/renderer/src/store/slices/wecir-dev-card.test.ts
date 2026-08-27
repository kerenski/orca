// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import {
  createWecirDevCardSlice,
  filterWecirDevCards,
  type WecirDevCardFilters,
  type WecirDevCardSlice
} from './wecir-dev-card'
import type {
  WecirDevCardRecord,
  WecirDevRepositorySelection
} from '../../../../shared/wecir-dev/contracts'
import type {
  WecirDevAnalyzeCardsResult,
  WecirDevOperationResponse
} from '../../../../shared/wecir-dev/operations'

const card = (overrides: Partial<WecirDevCardRecord>): WecirDevCardRecord => ({
  schemaVersion: 1,
  cardId: 'card-1',
  name: 'first-card',
  repository: { repositoryId: 'repo-1', path: '/repo', executionHost: 'local' },
  reference: { kind: 'issue', number: 1, owner: 'octo', repository: 'repo', title: 'First' },
  priority: 'high',
  dependencies: [],
  status: 'queued',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides
})

const filters = (overrides: Partial<WecirDevCardFilters> = {}): WecirDevCardFilters => ({
  kind: 'all',
  statuses: [],
  labels: [],
  assignee: '',
  priority: '',
  ...overrides
})

const repository = (repositoryId: string): WecirDevRepositorySelection => ({
  repositoryId,
  path: `/${repositoryId}`,
  executionHost: 'local',
  provider: 'github',
  name: repositoryId
})

function installAnalyzeCards(
  analyzeCards: (args: unknown) => Promise<WecirDevOperationResponse<WecirDevAnalyzeCardsResult>>
): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { wecirDev: { analyzeCards } }
  })
}

describe('Wecir Dev card filtering', () => {
  it('combines type, status, priority and assignee filters', () => {
    const cards = [
      card({ cardId: 'one' }),
      card({
        cardId: 'two',
        priority: 'low',
        status: 'completed',
        reference: { kind: 'pull_request', number: 2, owner: 'other', repository: 'repo' },
        assignees: ['other']
      })
    ]
    expect(
      filterWecirDevCards(
        cards,
        filters({
          kind: 'pull_request',
          statuses: ['completed'],
          priority: 'low',
          assignee: 'other'
        })
      )
    ).toHaveLength(1)
    expect(filterWecirDevCards(cards, filters({ priority: 'critical' }))).toHaveLength(0)
  })

  it('supports single, multiple and clear selection', () => {
    const state = create<WecirDevCardSlice>()((...args) => createWecirDevCardSlice(...args))
    state.getState().selectWecirDevCard('one')
    state.getState().toggleWecirDevCard('two')
    expect(state.getState().selectedCardIds).toEqual(['one', 'two'])
    state.getState().clearWecirDevCardSelection()
    expect(state.getState().selectedCardIds).toEqual([])
  })
})

describe('Wecir Dev card loading', () => {
  it('clears cards on repository changes and ignores out-of-order responses', async () => {
    let resolveA!: (response: WecirDevOperationResponse<WecirDevAnalyzeCardsResult>) => void
    let resolveB!: (response: WecirDevOperationResponse<WecirDevAnalyzeCardsResult>) => void
    const responseA = new Promise<WecirDevOperationResponse<WecirDevAnalyzeCardsResult>>(
      (resolve) => {
        resolveA = resolve
      }
    )
    const responseB = new Promise<WecirDevOperationResponse<WecirDevAnalyzeCardsResult>>(
      (resolve) => {
        resolveB = resolve
      }
    )
    const analyzeCards = vi.fn().mockReturnValueOnce(responseA).mockReturnValueOnce(responseB)
    installAnalyzeCards(analyzeCards)
    const state = create<WecirDevCardSlice>()((...args) => createWecirDevCardSlice(...args))
    const repoA = repository('repo-a')
    const repoB = repository('repo-b')

    state.getState().setCurrentRepository(repoA)
    const loadA = state.getState().loadWecirDevCards(repoA)
    state.getState().setCurrentRepository(repoB)
    expect(state.getState().cards).toEqual([])
    expect(state.getState().cardLoadState).toBe('idle')
    const loadB = state.getState().loadWecirDevCards(repoB)

    resolveA({
      schemaVersion: 1,
      requestId: 'a',
      ok: true,
      data: {
        cards: [card({ cardId: 'old', repository: repoA })],
        analyzedAt: '2026-01-01T00:00:00Z'
      }
    })
    await loadA
    expect(state.getState().cards).toEqual([])
    expect(state.getState().currentRepository).toEqual(repoB)

    resolveB({
      schemaVersion: 1,
      requestId: 'b',
      ok: true,
      data: {
        cards: [card({ cardId: 'new', repository: repoB })],
        analyzedAt: '2026-01-02T00:00:00Z'
      }
    })
    await loadB
    expect(state.getState().cards.map((item) => item.cardId)).toEqual(['new'])
    expect(state.getState().cardLoadState).toBe('success')
  })

  it('preserves cards and reports partial errors from the analysis response', async () => {
    installAnalyzeCards(
      vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: 'partial',
        ok: true,
        data: {
          cards: [card({ cardId: 'available', repository: repository('repo-a') })],
          analyzedAt: '2026-01-03T00:00:00Z',
          errors: [{ code: 'unknown', message: 'PR details failed', retryable: true }]
        }
      })
    )
    const state = create<WecirDevCardSlice>()((...args) => createWecirDevCardSlice(...args))

    await state.getState().loadWecirDevCards(repository('repo-a'))

    expect(state.getState().cardLoadState).toBe('partial')
    expect(state.getState().cards).toHaveLength(1)
    expect(state.getState().cardSyncError).toBe('PR details failed')
  })

  it('reports an initial load failure without partial state', async () => {
    installAnalyzeCards(
      vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: 'failed',
        ok: false,
        error: { code: 'unknown', message: 'failed', retryable: true }
      })
    )
    const state = create<WecirDevCardSlice>()((...args) => createWecirDevCardSlice(...args))
    const load = state.getState().loadWecirDevCards(repository('repo-a'))

    await load

    expect(state.getState().cardLoadState).toBe('error')
    expect(state.getState().cardSyncError).toBe('failed')
  })
})
