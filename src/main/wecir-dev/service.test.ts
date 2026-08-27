import { describe, expect, it, vi } from 'vitest'

const { assertRegisteredGitHubRepo, listGitHubData, getGitHubDataBatch } = vi.hoisted(() => ({
  assertRegisteredGitHubRepo: vi.fn(),
  listGitHubData: vi.fn(),
  getGitHubDataBatch: vi.fn()
}))

vi.mock('../ipc/github-repo-routing', () => ({
  assertRegisteredGitHubRepo,
  getGitHubRepoConnectionId: vi.fn(() => null)
}))
vi.mock('./github-data-adapter', () => ({ listGitHubData, getGitHubDataBatch }))

import { WecirDevService } from './service'
import type { CardRunner } from './types'

const repository = {
  repositoryId: 'repo-1',
  path: '/repo',
  executionHost: 'local' as const,
  owner: 'acme',
  name: 'app'
}
const registeredRepo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'app',
  badgeColor: '#fff',
  addedAt: 1
}
const store = {
  getRepo: vi.fn(() => registeredRepo),
  getRepos: vi.fn(() => [registeredRepo])
} as never

function makeRunner(): CardRunner {
  return vi.fn(async ({ issueNumber, card, tier }) => ({
    schemaVersion: 1 as const,
    ok: true as const,
    controllerPtyId: `pty-${issueNumber}`,
    worktreeId: `wt-${issueNumber}`,
    worktreePath: `/repo/.worktrees/issue-${issueNumber}-card`,
    branch: `issue-${issueNumber}-card`,
    workerAgent: `agent-${issueNumber}`,
    issue: issueNumber,
    card,
    tier
  }))
}

describe('WecirDevService', () => {
  it('runs batch cards serially and stops after a failure', async () => {
    const events: string[] = []
    const runCard: CardRunner = vi.fn(async ({ issueNumber, card, tier }) => {
      events.push(`start-${issueNumber}`)
      await Promise.resolve()
      if (issueNumber === 2) {
        throw Object.assign(new Error('failed'), {
          cardError: { code: 'unknown', message: 'failed', retryable: true }
        })
      }
      events.push(`done-${issueNumber}`)
      return {
        schemaVersion: 1 as const,
        ok: true as const,
        controllerPtyId: `pty-${issueNumber}`,
        worktreeId: `wt-${issueNumber}`,
        worktreePath: `/repo/.worktrees/issue-${issueNumber}-card`,
        branch: `issue-${issueNumber}-card`,
        workerAgent: `agent-${issueNumber}`,
        issue: issueNumber,
        card,
        tier
      }
    })
    assertRegisteredGitHubRepo.mockReturnValue(registeredRepo)
    const service = new WecirDevService(store, { runCard })

    const result = await service.startCardsBatch({
      repository,
      cards: [
        { issueNumber: 1, card: 'first' },
        { issueNumber: 2, card: 'second' },
        { issueNumber: 3, card: 'third' }
      ]
    })

    expect(events).toEqual(['start-1', 'done-1', 'start-2'])
    expect(runCard).toHaveBeenCalledTimes(2)
    expect(result.items.map((item) => item.issueNumber)).toEqual([1, 2])
    expect(result.stoppedOnFailure).toBe(true)
  })

  it('rejects an unregistered repository', async () => {
    const missingStore = { getRepo: vi.fn(() => undefined) } as never
    const service = new WecirDevService(missingStore, { runCard: makeRunner() })

    await expect(
      service.startCard({ repository, issueNumber: 1, card: 'first' })
    ).rejects.toMatchObject({ cardError: { code: 'repository_not_registered' } })
  })

  it('passes the canonical registered repository path to the runner', async () => {
    assertRegisteredGitHubRepo.mockReturnValue(registeredRepo)
    const runCard = makeRunner()
    const service = new WecirDevService(store, { runCard })

    await service.startCard({
      repository: { ...repository, path: '/repo/./' },
      issueNumber: 1,
      card: 'first'
    })

    expect(runCard).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo' }))
  })

  it('rejects a duplicate card name unless forced', async () => {
    assertRegisteredGitHubRepo.mockReturnValue(registeredRepo)
    const runCard = makeRunner()
    const service = new WecirDevService(store, { runCard, now: () => '2026-08-26T00:00:00.000Z' })
    const args = { repository, issueNumber: 1, card: 'first' }

    await service.startCard(args)
    await expect(service.startCard({ ...args, issueNumber: 2 })).rejects.toMatchObject({
      cardError: { code: 'worktree_invalid' }
    })
    expect(runCard).toHaveBeenCalledTimes(1)
  })

  it('analyzes selected details and preserves cards when a detail fails', async () => {
    assertRegisteredGitHubRepo.mockReturnValue(registeredRepo)
    listGitHubData.mockResolvedValue({
      items: [
        { number: 1, type: 'issue', title: 'Same title', labels: ['high'], references: [] },
        { number: 2, type: 'issue', title: 'Dependency', labels: [], references: [] }
      ],
      sources: {
        issues: { owner: 'acme', repo: 'app' },
        prs: null,
        originCandidate: null,
        upstreamCandidate: null
      }
    })
    getGitHubDataBatch.mockResolvedValue({
      items: [
        {
          item: { number: 1, type: 'issue', title: 'Same title', labels: ['high'] },
          body: 'depends on #2',
          comments: { count: 1, latest: { body: 'latest comment' } },
          references: [],
          timelineItems: [],
          checks: []
        }
      ],
      errors: [{ number: 2, type: 'issue', error: { type: 'not_found', message: 'missing' } }]
    })
    const service = new WecirDevService(store, {
      runCard: makeRunner(),
      now: () => '2026-08-26T00:00:00.000Z'
    })
    await service.startCard({ repository, issueNumber: 1, card: 'issue-1-same-title' })

    const result = await service.analyzeCards({ repository })

    expect(getGitHubDataBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          number: 1,
          type: 'issue',
          issueRepo: { owner: 'acme', repo: 'app' }
        })
      ])
    )
    expect(result.cards[0]).toMatchObject({
      name: 'issue-1-same-title-r2',
      dependencies: [{ relation: 'blocked_by', targetCardId: 'repo-1:2' }],
      analysis: {
        suggestedPriority: 'high',
        dependencies: [{ relation: 'blocked_by', targetCardId: 'repo-1:2' }],
        generatedAt: '2026-08-26T00:00:00.000Z'
      }
    })
    expect(result.cards[1].analysis?.riskFlags).toContain('github_detail_unavailable')
  })
})
