import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import type { AppState } from '../types'
import { createWecirDevCardSlice, type WecirDevCardSlice } from './wecir-dev-card'

describe('createWecirDevCardSlice', () => {
  it('owns repository selection outside the Tasks state', () => {
    const store = createStore<WecirDevCardSlice>()(
      (set, get, api) =>
        createWecirDevCardSlice(set as never, get as never, api as never) as Pick<
          AppState,
          keyof WecirDevCardSlice
        >
    )

    expect(store.getState().wecirDevCardRepositoryId).toBeNull()
    store.getState().setWecirDevCardRepositoryId('repo-1')
    expect(store.getState().wecirDevCardRepositoryId).toBe('repo-1')
    expect(store.getState()).not.toHaveProperty('taskPageData')
    expect(store.getState()).not.toHaveProperty('githubTaskDrawerWorkItem')
  })
})
