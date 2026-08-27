import type { StateCreator } from 'zustand'
import {
  WECIR_DEV_SCHEMA_VERSION,
  type WecirDevCardRecord,
  type WecirDevRepositorySelection
} from '../../../../shared/wecir-dev/contracts'

export type WecirDevCardFilters = {
  kind: 'all' | 'issue' | 'pull_request'
  statuses: string[]
  labels: string[]
  assignee: string
  priority: string
}

export type WecirDevCardLoadState =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'success'
  | 'empty'
  | 'error'
  | 'partial'

export function filterWecirDevCards(
  cards: WecirDevCardRecord[],
  filters: WecirDevCardFilters
): WecirDevCardRecord[] {
  return cards.filter((card) => {
    return (
      (filters.kind === 'all' || card.reference.kind === filters.kind) &&
      (!filters.statuses.length || filters.statuses.includes(card.status)) &&
      (!filters.priority || card.priority === filters.priority) &&
      (!filters.labels.length || filters.labels.every((label) => card.labels?.includes(label))) &&
      (!filters.assignee || card.assignees?.includes(filters.assignee))
    )
  })
}

function requestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `wecir-${Date.now()}`
}

export type WecirDevCardSlice = {
  cards: WecirDevCardRecord[]
  repositories: WecirDevRepositorySelection[]
  currentRepository: WecirDevRepositorySelection | null
  cardLoadState: WecirDevCardLoadState
  cardSyncError: string | null
  cardSyncErrorCode: string | null
  lastCardSyncAt: string | null
  selectedCardId: string | null
  selectedCardIds: string[]
  setSelectedCardId: (id: string | null) => void
  setRepositories: (repositories: WecirDevRepositorySelection[]) => void
  setCurrentRepository: (repository: WecirDevRepositorySelection | null) => void
  loadWecirDevCards: (repository?: WecirDevRepositorySelection) => Promise<void>
  refreshWecirDevCards: () => Promise<void>
  selectWecirDevCard: (id: string) => void
  toggleWecirDevCard: (id: string) => void
  clearWecirDevCardSelection: () => void
}

export const createWecirDevCardSlice: StateCreator<WecirDevCardSlice> = (set, get) => {
  let loadGeneration = 0

  return {
    cards: [],
    repositories: [],
    currentRepository: null,
    cardLoadState: 'idle',
    cardSyncError: null,
    cardSyncErrorCode: null,
    lastCardSyncAt: null,
    selectedCardId: null,
    selectedCardIds: [],
    setSelectedCardId: (id) => set({ selectedCardId: id }),
    setRepositories: (repositories) => set({ repositories }),
    setCurrentRepository: (repository) => {
      loadGeneration += 1
      set({
        currentRepository: repository,
        cards: [],
        cardLoadState: 'idle',
        cardSyncError: null,
        cardSyncErrorCode: null,
        lastCardSyncAt: null,
        selectedCardId: null,
        selectedCardIds: []
      })
    },
    loadWecirDevCards: async (repository = get().currentRepository ?? undefined) => {
      const generation = ++loadGeneration
      if (!repository || !window.api?.wecirDev?.analyzeCards) {
        set({
          cardLoadState: repository ? 'error' : 'empty',
          cardSyncError: repository ? 'Wecir Dev API is unavailable' : null,
          cardSyncErrorCode: null
        })
        return
      }
      const refreshing = get().cards.length > 0
      set({
        currentRepository: repository,
        cardLoadState: refreshing ? 'refreshing' : 'loading',
        cardSyncError: null,
        cardSyncErrorCode: null
      })
      const currentRequestId = requestId()
      try {
        const response = await window.api.wecirDev.analyzeCards({
          schemaVersion: WECIR_DEV_SCHEMA_VERSION,
          requestId: currentRequestId,
          payload: { repository }
        })
        const isCurrentRequest =
          generation === loadGeneration &&
          get().currentRepository?.repositoryId === repository.repositoryId
        if (!isCurrentRequest) {
          return
        }
        if (!response.ok || !response.data) {
          const failure = new Error(response.error?.message ?? 'Unable to load cards')
          if (response.error) {
            Object.assign(failure, { code: response.error.code })
          }
          throw failure
        }
        const hasPartialErrors = Boolean(response.data.errors?.length)
        const firstError = response.data.errors?.[0]
        set({
          cards: response.data.cards,
          cardLoadState: hasPartialErrors
            ? 'partial'
            : response.data.cards.length
              ? 'success'
              : 'empty',
          lastCardSyncAt: response.data.analyzedAt,
          cardSyncError: firstError?.message ?? null,
          cardSyncErrorCode: firstError?.code ?? null
        })
      } catch (error) {
        if (
          generation !== loadGeneration ||
          get().currentRepository?.repositoryId !== repository.repositoryId
        ) {
          return
        }
        set({
          cardLoadState: refreshing ? 'partial' : 'error',
          cardSyncErrorCode: error instanceof Error && 'code' in error ? String(error.code) : null,
          cardSyncError: error instanceof Error ? error.message : 'Unable to load cards'
        })
      }
    },
    refreshWecirDevCards: async () => get().loadWecirDevCards(),
    selectWecirDevCard: (id) => set({ selectedCardId: id, selectedCardIds: [id] }),
    toggleWecirDevCard: (id) =>
      set((state) => {
        const selected = state.selectedCardIds.includes(id)
          ? state.selectedCardIds.filter((item) => item !== id)
          : [...state.selectedCardIds, id]
        return {
          selectedCardIds: selected,
          selectedCardId: selected.length === 1 ? selected[0] : null
        }
      }),
    clearWecirDevCardSelection: () => set({ selectedCardId: null, selectedCardIds: [] })
  }
}
