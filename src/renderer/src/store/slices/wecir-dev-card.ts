import type { StateCreator } from 'zustand'

export type WecirDevCardSlice = {
  selectedCardId: string | null
  setSelectedCardId: (id: string | null) => void
}

export const createWecirDevCardSlice: StateCreator<WecirDevCardSlice> = (set) => ({
  selectedCardId: null,
  setSelectedCardId: (id) => set({ selectedCardId: id })
})
