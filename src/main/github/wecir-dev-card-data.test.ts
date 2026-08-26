import { describe, expect, it, vi } from 'vitest'
import { getWecirDevGitHubCardData } from './wecir-dev-card-data'
import type { GitHubWorkItem } from '../../shared/github/work-item-types'

const issue = (number: number): Omit<GitHubWorkItem, 'repoId'> => ({
  id: `issue:${number}`,
  type: 'issue',
  number,
  title: `Issue ${number}`,
  state: 'open',
  url: `https://github.com/acme/orca/issues/${number}`,
  labels: ['bug'],
  milestone: 'M1',
  updatedAt: '2026-08-26T00:00:00Z',
  author: 'octo'
})

const pr = (number: number): Omit<GitHubWorkItem, 'repoId'> => ({
  ...issue(number),
  id: `pr:${number}`,
  type: 'pr',
  state: 'draft',
  url: `https://github.com/acme/orca/pull/${number}`,
  headSha: 'abc123',
  prRepo: { owner: 'acme', repo: 'orca' }
})

describe('getWecirDevGitHubCardData', () => {
  it('projects issue details and preserves list-side classified errors', async () => {
    const source = {
      listWorkItems: vi.fn().mockResolvedValue({
        items: [issue(7)],
        sources: { issues: null, prs: null, originCandidate: null, upstreamCandidate: null },
        errors: { prs: { type: 'rate_limited', message: 'limited' } }
      }),
      getWorkItem: vi.fn().mockResolvedValue(issue(7)),
      getWorkItemDetails: vi.fn().mockResolvedValue({
        item: issue(7),
        body: 'body',
        comments: [
          {
            id: 1,
            author: 'octo',
            authorAvatarUrl: '',
            body: 'hello',
            createdAt: '2026-08-26T01:00:00Z',
            url: 'https://github.com/acme/orca/issues/7#issuecomment-1'
          }
        ],
        timelineItems: [
          {
            id: 't1',
            event: 'cross-referenced',
            actor: 'octo',
            actorAvatarUrl: '',
            createdAt: '2026-08-26T01:00:00Z',
            source: {
              type: 'pr',
              number: 8,
              title: 'PR 8',
              url: 'https://github.com/acme/orca/pull/8',
              repository: 'acme/orca'
            }
          }
        ]
      }),
      getPRChecks: vi.fn(),
      getPRCheckDetails: vi.fn()
    }

    const result = await getWecirDevGitHubCardData({ limit: 1 }, source)

    expect(result.schemaVersion).toBe(1)
    expect(result.items[0]).toMatchObject({
      reference: { kind: 'issue', owner: 'acme', repository: 'orca', number: 7 },
      body: 'body',
      milestone: 'M1',
      comments: { count: 1, authors: ['octo'] },
      references: [{ kind: 'pull_request', number: 8 }]
    })
    expect(result.listErrors).toEqual({ prs: { type: 'rate_limited', message: 'limited' } })
  })

  it('keeps successful items when another detail fetch fails and hydrates PR checks', async () => {
    const source = {
      listWorkItems: vi.fn().mockResolvedValue({
        items: [issue(7), pr(8)],
        sources: { issues: null, prs: null, originCandidate: null, upstreamCandidate: null }
      }),
      getWorkItem: vi.fn().mockImplementation((number: number) =>
        number === 7 ? Promise.resolve(issue(7)) : Promise.resolve(pr(8))
      ),
      getWorkItemDetails: vi.fn().mockImplementation((number: number) =>
        number === 7
          ? Promise.reject(new Error('HTTP 403 permission denied'))
          : Promise.resolve({ item: pr(8), body: 'pr body', comments: [] })
      ),
      getPRChecks: vi.fn().mockResolvedValue([
        {
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          checkRunId: 42,
          url: 'https://github.com/acme/orca/actions/runs/42'
        }
      ]),
      getPRCheckDetails: vi.fn().mockResolvedValue({
        summary: 'ok',
        text: null,
        startedAt: null,
        completedAt: null,
        annotations: [],
        jobs: []
      })
    }

    const result = await getWecirDevGitHubCardData({ limit: 2 }, source)

    expect(result.schemaVersion).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      reference: { kind: 'pull_request', number: 8 },
      draft: true,
      checks: [{ name: 'CI', conclusion: 'success', details: { summary: 'ok' } }]
    })
    expect(result.itemErrors).toEqual([
      { number: 7, type: 'issue', error: { type: 'permission_denied', message: expect.any(String) } }
    ])
    expect(source.getPRChecks).toHaveBeenCalledWith(8, 'abc123', { owner: 'acme', repo: 'orca' })
    expect(source.getPRCheckDetails).toHaveBeenCalledWith(
      expect.objectContaining({ checkRunId: 42, checkName: 'CI' })
    )
  })
})
