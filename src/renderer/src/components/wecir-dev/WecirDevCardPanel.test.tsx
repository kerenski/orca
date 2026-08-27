// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WecirDevCardRecord } from '../../../../shared/wecir-dev/contracts'
import { WecirDevCardPanel } from './WecirDevCardPanel'

afterEach(cleanup)

const makeCard = (overrides: Partial<WecirDevCardRecord> = {}): WecirDevCardRecord => ({
  schemaVersion: 1,
  cardId: 'card-1',
  name: 'first-card',
  repository: { repositoryId: 'repo', path: '/repo', executionHost: 'local' },
  reference: {
    kind: 'issue',
    number: 1,
    owner: 'octo',
    repository: 'repo',
    title: 'First issue',
    url: 'https://github.com/octo/repo/issues/1'
  },
  url: 'https://github.com/octo/repo/issues/1',
  priority: 'high',
  labels: ['bug'],
  assignees: ['alice'],
  body: 'Issue body',
  dependencies: [],
  status: 'queued',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  analysis: {
    summary: 'Summary',
    suggestedPriority: 'high',
    dependencies: [],
    riskFlags: [],
    acceptanceCriteria: [],
    generatedAt: '2026-01-01T00:00:00Z',
    topoLevel: 2,
    blockedCount: 1,
    cycleWarning: 'Cycle warning',
    suggestedTier: 'simple'
  },
  ...overrides
})

describe('WecirDevCardPanel', () => {
  it('selects multiple cards and clears the queue', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    const onClear = vi.fn()
    render(
      <WecirDevCardPanel
        cards={[
          makeCard(),
          makeCard({
            cardId: 'card-2',
            name: 'second-card',
            reference: {
              kind: 'pull_request',
              number: 2,
              owner: 'octo',
              repository: 'repo',
              title: 'PR'
            },
            labels: ['enhancement'],
            assignees: ['bob'],
            priority: 'low'
          })
        ]}
        selectedIds={['card-1', 'card-2']}
        onToggle={onToggle}
        onClear={onClear}
      />
    )
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /clear selection/i }))
    expect(onClear).toHaveBeenCalledOnce()
    await user.click(screen.getAllByRole('checkbox')[0])
    expect(onToggle).toHaveBeenCalledWith('card-1')
  })

  it('filters by issue type and multiple labels', async () => {
    const user = userEvent.setup()
    render(
      <WecirDevCardPanel
        cards={[
          makeCard(),
          makeCard({
            cardId: 'card-2',
            name: 'second-card',
            reference: { kind: 'pull_request', number: 2, owner: 'octo', repository: 'repo' },
            labels: ['enhancement']
          })
        ]}
        selectedIds={[]}
        onToggle={vi.fn()}
        onClear={vi.fn()}
      />
    )
    await user.click(screen.getAllByRole('combobox', { name: 'Type' })[0])
    await user.click(screen.getByRole('option', { name: 'Pull request' }))
    expect(screen.getByText(/second-card/)).toBeInTheDocument()
    expect(screen.queryByText(/first-card/)).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /labels/i })[0])
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'enhancement' }))
    expect(screen.getByText(/second-card/)).toBeInTheDocument()
  })

  it('opens the detail sheet with body and CI fallback', async () => {
    const user = userEvent.setup()
    render(
      <WecirDevCardPanel
        cards={[
          makeCard({
            reference: { kind: 'pull_request', number: 4, owner: 'octo', repository: 'repo' }
          })
        ]}
        selectedIds={[]}
        onToggle={vi.fn()}
        onClear={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: /#4/ }))
    expect(screen.getByText('正文')).toBeInTheDocument()
    expect(screen.getByText('Issue body')).toBeInTheDocument()
    expect(screen.getByText('bug')).toBeInTheDocument()
    expect(screen.getByText('@alice')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open on github/i })).toHaveAttribute(
      'href',
      'https://github.com/octo/repo/issues/1'
    )
    expect(screen.getAllByText('未提供').length).toBeGreaterThan(0)
  })

  it('closes details when the selection is cleared', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(
      <WecirDevCardPanel
        cards={[makeCard()]}
        selectedIds={['card-1']}
        onToggle={vi.fn()}
        onClear={onClear}
      />
    )

    await user.click(screen.getByRole('button', { name: /#1/ }))
    expect(screen.getByText('正文')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /clear selection/i, hidden: true }))

    expect(onClear).toHaveBeenCalledOnce()
    expect(screen.queryByText('正文')).not.toBeInTheDocument()
  })
})
