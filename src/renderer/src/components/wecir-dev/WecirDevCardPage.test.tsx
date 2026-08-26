// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Repo } from '../../../../shared/repo-types'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  closeWecirDevCardPage: vi.fn(),
  openModal: vi.fn(),
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn(),
  setWecirDevCardRepositoryId: vi.fn(),
  refreshPreflightStatus: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

vi.mock('@/lib/local-preflight-context', () => ({
  getLocalPreflightContext: () => undefined,
  localPreflightContextKey: () => 'local'
}))

import WecirDevCardPage from './WecirDevCardPage'

function localRepo(): Repo {
  return {
    id: 'repo-1',
    path: '/tmp/repo-1',
    displayName: 'repo-1',
    badgeColor: 'gray',
    addedAt: 1,
    kind: 'git'
  }
}

function setPageState(overrides: Record<string, unknown> = {}): void {
  mocks.state = {
    repos: [],
    closeWecirDevCardPage: mocks.closeWecirDevCardPage,
    openModal: mocks.openModal,
    openSettingsPage: mocks.openSettingsPage,
    openSettingsTarget: mocks.openSettingsTarget,
    wecirDevCardRepositoryId: null,
    setWecirDevCardRepositoryId: mocks.setWecirDevCardRepositoryId,
    preflightStatus: null,
    preflightStatusChecked: false,
    preflightStatusContextKey: null,
    preflightStatusLoading: false,
    preflightStatusError: null,
    refreshPreflightStatus: mocks.refreshPreflightStatus,
    ...overrides
  }
}

let root: Root | null = null

async function renderPage(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <TooltipProvider>
        <WecirDevCardPage />
      </TooltipProvider>
    )
  })
  return container
}

describe('WecirDevCardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setPageState()
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.innerHTML = ''
  })

  it('shows an explicit empty state when no local repository exists', async () => {
    const container = await renderPage()
    const emptyState = container.querySelector('[data-testid="wecir-dev-card-empty-state"]')

    expect(emptyState?.getAttribute('data-state')).toBe('no-repositories')
    expect(emptyState?.textContent).toContain('No local Git repositories')
    expect(mocks.refreshPreflightStatus).not.toHaveBeenCalled()
  })

  it('shows an explicit empty state when GitHub is not authenticated', async () => {
    setPageState({
      repos: [localRepo()],
      preflightStatus: {
        git: { installed: true },
        gh: { installed: true, authenticated: false }
      },
      preflightStatusChecked: true,
      preflightStatusContextKey: 'local'
    })

    const container = await renderPage()
    const emptyState = container.querySelector('[data-testid="wecir-dev-card-empty-state"]')

    expect(emptyState?.getAttribute('data-state')).toBe('github-auth-required')
    expect(emptyState?.textContent).toContain('GitHub authentication required')
    expect(mocks.setWecirDevCardRepositoryId).toHaveBeenCalledWith('repo-1')
  })
})
