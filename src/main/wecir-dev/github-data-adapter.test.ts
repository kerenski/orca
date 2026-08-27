import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listWorkItems: vi.fn(),
  getWorkItemOutcome: vi.fn(),
  getWorkItemByOwnerRepoOutcome: vi.fn(),
  getWorkItemDetails: vi.fn(),
  getPRChecks: vi.fn(),
  getPRCheckDetails: vi.fn()
}))

vi.mock('../github/client', () => mocks)
vi.mock('../github/work-item-details', () => ({ getWorkItemDetails: mocks.getWorkItemDetails }))

import {
  getGitHubCheckDetails,
  getGitHubChecks,
  getGitHubData,
  getGitHubDataBatch,
  listGitHubData
} from './github-data-adapter'

const item = {
  id: 'issue:1',
  type: 'issue' as const,
  number: 1,
  title: 'Issue one',
  state: 'open' as const,
  url: 'https://github.com/acme/app/issues/1',
  labels: ['bug'],
  updatedAt: '2026-08-26T00:00:00Z',
  author: 'alice',
  assignees: [{ login: 'bob', name: null, avatarUrl: '' }],
  issueRepo: { owner: 'acme', repo: 'app' }
}

const details = {
  item,
  body: 'body',
  comments: [
    {
      id: 1,
      author: 'bob',
      authorAvatarUrl: '',
      body: 'latest',
      createdAt: '2026-08-26T01:00:00Z',
      url: 'https://github.com/acme/app/issues/1#comment-1'
    }
  ],
  timelineItems: [
    {
      id: 'timeline-1',
      event: 'cross-referenced' as const,
      actor: 'alice',
      actorAvatarUrl: '',
      createdAt: '2026-08-26T01:00:00Z',
      source: {
        type: 'pr' as const,
        number: 2,
        title: 'PR',
        url: 'https://github.com/acme/app/pull/2'
      }
    }
  ],
  checks: []
}

describe('GitHub card data adapter', () => {
  it('delegates list reads with official routing and preserves partial source errors', async () => {
    mocks.listWorkItems.mockResolvedValueOnce({
      items: [item],
      sources: {
        issues: { owner: 'acme', repo: 'app' },
        prs: null,
        originCandidate: null,
        upstreamCandidate: null
      },
      errors: { prs: { type: 'permission_denied', message: 'private repository' } }
    })

    const result = await listGitHubData({
      repoPath: '/repo',
      repoId: 'repo-1',
      connectionId: 'connection-1',
      issueSourcePreference: 'upstream',
      localGitOptions: { wslDistro: 'Ubuntu' },
      limit: 10,
      query: 'is:open',
      page: 2,
      noCache: true
    })

    expect(mocks.listWorkItems).toHaveBeenCalledWith(
      '/repo',
      10,
      'is:open',
      2,
      'upstream',
      'connection-1',
      true,
      { wslDistro: 'Ubuntu' }
    )
    expect(result.items[0]).toMatchObject({ number: 1, labels: ['bug'], assignees: ['bob'] })
    expect(result.errors?.prs?.type).toBe('permission_denied')
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, hasNext: false })
  })

  it('keeps successful details when one batch item fails and classifies the error', async () => {
    mocks.getWorkItemOutcome.mockImplementation(async (_path: string, number: number) =>
      number === 1 ? { item } : { item: null }
    )
    mocks.getWorkItemDetails.mockResolvedValue(details)

    const result = await getGitHubDataBatch([
      { repoPath: '/repo', number: 1, type: 'issue' },
      { repoPath: '/repo', number: 2, type: 'issue' }
    ])

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      body: 'body',
      comments: { count: 1 },
      references: [{ number: 2 }]
    })
    expect(result.errors).toEqual([
      { number: 2, type: 'issue', error: { type: 'not_found', message: expect.any(String) } }
    ])
  })

  it('exposes checks and check details through the existing clients', async () => {
    mocks.getPRChecks.mockResolvedValue([
      { name: 'CI', status: 'completed', conclusion: 'success', url: null }
    ])
    mocks.getPRCheckDetails.mockResolvedValue({
      name: 'CI',
      status: 'completed',
      conclusion: 'success',
      url: null,
      detailsUrl: null,
      startedAt: null,
      completedAt: null,
      title: null,
      summary: null,
      text: null,
      annotations: [],
      jobs: []
    })

    await getGitHubChecks({
      repoPath: '/repo',
      prNumber: 3,
      headSha: 'abc',
      prRepo: { owner: 'acme', repo: 'app' }
    })
    await getGitHubCheckDetails({
      repoPath: '/repo',
      checkRunId: 9,
      prRepo: { owner: 'acme', repo: 'app' }
    })

    expect(mocks.getPRChecks).toHaveBeenCalledWith(
      '/repo',
      3,
      'abc',
      { owner: 'acme', repo: 'app' },
      { noCache: undefined },
      undefined,
      {}
    )
    expect(mocks.getPRCheckDetails).toHaveBeenCalledWith(
      '/repo',
      {
        checkRunId: 9,
        workflowRunId: undefined,
        checkName: undefined,
        url: undefined,
        prRepo: { owner: 'acme', repo: 'app' }
      },
      undefined,
      {}
    )
  })

  it('returns only the public projection and redacts credential-shaped errors', async () => {
    mocks.getWorkItemOutcome.mockResolvedValueOnce({
      item: null,
      error: { type: 'permission_denied', message: 'token=ghp_should_not_escape' }
    })
    const result = await getGitHubDataBatch([{ repoPath: '/repo', number: 9 }])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('ghp_should_not_escape')
    expect(serialized).not.toMatch(/authorization|cookie/i)
    expect(serialized).not.toContain('token')
  })

  it.each([
    ['permission_denied', 'permission_denied'],
    ['rate_limited', 'rate_limited'],
    ['network_error', 'network_error'],
    ['not_found', 'not_found']
  ] as const)('preserves %s item read classification', async (type, expected) => {
    mocks.getWorkItemOutcome.mockResolvedValueOnce({ item: null, error: { type, message: type } })
    const result = await getGitHubDataBatch([{ repoPath: '/repo', number: 9, type: 'issue' }])
    expect(result.errors[0]?.error.type).toBe(expected)
  })

  it('uses explicit issue repository routing for detail reads', async () => {
    mocks.getWorkItemByOwnerRepoOutcome.mockResolvedValueOnce({ item })
    mocks.getWorkItemDetails.mockResolvedValueOnce(details)
    await getGitHubData({
      repoPath: '/repo',
      number: 1,
      type: 'issue',
      issueRepo: { owner: 'acme', repo: 'app' },
      connectionId: 'connection-1',
      localGitOptions: { wslDistro: 'Ubuntu' }
    })
    expect(mocks.getWorkItemByOwnerRepoOutcome).toHaveBeenCalledWith(
      '/repo',
      { owner: 'acme', repo: 'app' },
      1,
      'issue',
      'connection-1',
      { wslDistro: 'Ubuntu' }
    )
  })
})
