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
      errors: [
        {
          number: 2,
          type: 'issue',
          error: { type: 'permission_denied', message: 'GitHub token is not authenticated' }
        }
      ]
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
    const analyzedIssue = result.cards.find((card) => card.reference.number === 1)!
    expect(analyzedIssue).toMatchObject({
      priority: 'normal',
      name: 'issue-1-same-title-r2',
      dependencies: [
        expect.objectContaining({
          relation: 'blocked_by',
          targetReference: expect.objectContaining({ number: 2 }),
          note: expect.stringContaining('explicit_text')
        })
      ],
      analysis: {
        suggestedPriority: 'normal',
        dependencies: [
          expect.objectContaining({
            relation: 'blocked_by',
            targetReference: expect.objectContaining({ number: 2 })
          })
        ],
        generatedAt: '2026-08-26T00:00:00.000Z'
      }
    })
    expect(result.cards.find((card) => card.reference.number === 2)?.analysis?.riskFlags).toContain(
      'github_detail_unavailable'
    )
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'github_auth_failed',
        message: 'GitHub token is not authenticated'
      })
    ])
  })

  it('keeps rule priority and main order when model assistance disagrees', async () => {
    assertRegisteredGitHubRepo.mockReturnValue(registeredRepo)
    listGitHubData.mockResolvedValue({
      items: [
        {
          number: 2,
          type: 'issue',
          title: 'Low priority',
          labels: ['priority: low'],
          references: [{ kind: 'issue', number: 9, owner: 'acme', repository: 'app' }],
          updatedAt: '2026-08-26T00:00:00.000Z'
        },
        {
          number: 1,
          type: 'issue',
          title: 'High priority',
          labels: ['type: bug', 'priority: high'],
          references: [],
          updatedAt: '2026-08-26T00:00:00.000Z'
        }
      ],
      sources: {
        issues: { owner: 'acme', repo: 'app' },
        prs: null,
        originCandidate: null,
        upstreamCandidate: null
      }
    })
    getGitHubDataBatch.mockResolvedValue({ items: [], errors: [] })
    const modelAssist = vi.fn(async ({ number }) => ({
      explanation: `Model explanation for #${number}`,
      confidence: number === 1 ? 0.1 : 0.99
    }))
    const service = new WecirDevService(store, {
      modelAssist,
      now: () => '2026-08-26T00:00:00.000Z'
    })

    const result = await service.analyzeCards({ repository })
    const high = result.cards.find((card) => card.reference.number === 1)!
    const low = result.cards.find((card) => card.reference.number === 2)!

    expect(result.cards.map((card) => card.reference.number)).toEqual([1, 2])
    expect(high).toMatchObject({ priority: 'high' })
    expect(high.analysis).toMatchObject({
      score: 100,
      priorityBand: 'P0',
      suggestedTier: 'complex',
      explanation: 'Model explanation for #1',
      confidence: 0.1
    })
    expect(low).toMatchObject({ priority: 'normal' })
    expect(low.analysis).toMatchObject({
      score: 10,
      priorityBand: 'P3',
      suggestedTier: 'simple',
      explanation: 'Model explanation for #2',
      confidence: 0.99
    })
    expect(modelAssist).toHaveBeenCalledTimes(2)
  })

  it('returns pure rule analysis when model assistance fails', async () => {
    assertRegisteredGitHubRepo.mockReturnValue(registeredRepo)
    listGitHubData.mockResolvedValue({
      items: [
        {
          number: 3,
          type: 'issue',
          title: 'Security issue',
          labels: ['severity: critical', 'type: security'],
          references: [],
          updatedAt: '2026-08-26T00:00:00.000Z'
        }
      ],
      sources: {
        issues: { owner: 'acme', repo: 'app' },
        prs: null,
        originCandidate: null,
        upstreamCandidate: null
      }
    })
    getGitHubDataBatch.mockResolvedValue({ items: [], errors: [] })
    const service = new WecirDevService(store, {
      modelAssist: vi.fn(async () => {
        throw new Error('model unavailable')
      }),
      now: () => '2026-08-26T00:00:00.000Z'
    })

    const result = await service.analyzeCards({ repository })

    expect(result.cards[0].analysis).toMatchObject({
      score: 130,
      priorityBand: 'P0',
      suggestedPriority: 'critical',
      suggestedTier: 'complex',
      confidence: 0.9
    })
    expect(result.cards[0].analysis?.explanation).toContain('critical severity')
    expect(result.cards[0].analysis?.explanation).not.toContain('Model')
  })

  it('uses detail references for dependency analysis and impact scoring', async () => {
    assertRegisteredGitHubRepo.mockReturnValue(registeredRepo)
    listGitHubData.mockResolvedValue({
      items: [1, 2, 3].map((number) => ({
        number,
        type: 'issue' as const,
        title: `Issue ${number}`,
        labels: [],
        references: [],
        updatedAt: '2026-08-26T00:00:00.000Z'
      })),
      sources: {
        issues: { owner: 'acme', repo: 'app' },
        prs: null,
        originCandidate: null,
        upstreamCandidate: null
      }
    })
    getGitHubDataBatch.mockResolvedValue({
      items: [1, 2, 3].map((number) => ({
        item: {
          number,
          type: 'issue' as const,
          title: `Issue ${number}`,
          labels: []
        },
        body: '',
        comments: { count: 0 },
        references:
          number === 1
            ? [
                { kind: 'issue' as const, number: 2, owner: 'acme', repository: 'app' },
                { kind: 'issue' as const, number: 3, owner: 'acme', repository: 'app' }
              ]
            : [],
        timelineItems: [],
        checks: []
      })),
      errors: []
    })
    const service = new WecirDevService(store, {
      now: () => '2026-08-26T00:00:00.000Z'
    })

    const result = await service.analyzeCards({
      repository,
      priorityConfig: { staleAfterDays: 0, stalePointsPerDay: 0, staleMaxPoints: 0 }
    })
    const issue = result.cards.find((card) => card.reference.number === 1)!

    expect(issue.dependencies).toEqual([
      expect.objectContaining({
        relation: 'blocked_by',
        targetReference: expect.objectContaining({ number: 2 }),
        note: 'cross_reference: #2'
      }),
      expect.objectContaining({
        relation: 'blocked_by',
        targetReference: expect.objectContaining({ number: 3 }),
        note: 'cross_reference: #3'
      })
    ])
    expect(issue.analysis).toMatchObject({ score: 0, priorityBand: 'P3' })
    expect(issue.analysis?.scoreDetails).toContainEqual(
      expect.objectContaining({ rule: 'multiple-impact', points: 20 })
    )
  })
})
