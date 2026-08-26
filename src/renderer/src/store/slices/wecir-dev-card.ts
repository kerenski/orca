import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

export type WecirDevCardSlice = {
  wecirDevCardRepositoryId: string | null
  setWecirDevCardRepositoryId: (repositoryId: string | null) => void
}

export const createWecirDevCardSlice: StateCreator<AppState, [], [], WecirDevCardSlice> = (
  set
) => ({
  wecirDevCardRepositoryId: null,
  setWecirDevCardRepositoryId: (wecirDevCardRepositoryId) => set({ wecirDevCardRepositoryId })
})
