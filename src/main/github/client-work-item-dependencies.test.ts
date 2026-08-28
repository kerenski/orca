import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ghExecFileAsyncMock, acquireMock, releaseMock } = vi.hoisted(() => ({
  ghExecFileAsyncMock: vi.fn(),
  acquireMock: vi.fn(),
  releaseMock: vi.fn()
}))

vi.mock('./gh-utils', () => ({
  acquire: acquireMock,
  release: releaseMock,
  ghExecFileAsync: ghExecFileAsyncMock,
  classifyListIssuesError: (message: string) => ({ type: 'unknown', message })
}))

vi.mock('./github-api-repository', () => ({
  githubHostExecOptions: (ownerRepo: { host?: string }) =>
    ownerRepo.host ? { host: ownerRepo.host } : {}
}))

import {
  _resetIssueDependencyCacheForTests,
  fetchIssueDependencies
} from './client/list/work-item-dependencies'
import { mapIssueWorkItem } from './client/map/work-item'

describe('GitHub issue dependencies', () => {
  beforeEach(() => {
    ghExecFileAsyncMock.mockReset()
    _resetIssueDependencyCacheForTests()
    acquireMock.mockReset()
    releaseMock.mockReset()
    acquireMock.mockResolvedValue(undefined)
  })

  it('maps blocked_by and blocking REST responses with repository identities', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            number: 3,
            repository_url: 'https://github.acme.test/acme/other',
            repository: { name: 'widgets', owner: { login: 'acme' } }
          }
        ])
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          { number: 7, repository: { name: 'widgets', owner: { login: 'acme' } } }
        ])
      })
    const issue = {
      id: 'issue:5',
      type: 'issue' as const,
      number: 5,
      title: 'Issue',
      state: 'open' as const,
      url: '',
      labels: [],
      updatedAt: '',
      author: null
    }
    const result = await fetchIssueDependencies([issue], {
      owner: 'acme',
      repo: 'widgets',
      host: 'github.acme.test'
    })
    expect(ghExecFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      [
        'api',
        '--cache',
        '120s',
        'repos/acme/widgets/issues/5/dependencies/blocked_by?per_page=100'
      ],
      { host: 'github.acme.test' }
    )
    expect(ghExecFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      ['api', '--cache', '120s', 'repos/acme/widgets/issues/5/dependencies/blocking?per_page=100'],
      { host: 'github.acme.test' }
    )
    expect(result.items[0]?.dependencyRelations).toEqual([
      {
        parent: {
          type: 'issue',
          number: 3,
          repo: { owner: 'acme', repo: 'other', host: 'github.acme.test' }
        },
        child: {
          type: 'issue',
          number: 5,
          repo: { owner: 'acme', repo: 'widgets', host: 'github.acme.test' }
        }
      },
      {
        parent: {
          type: 'issue',
          number: 5,
          repo: { owner: 'acme', repo: 'widgets', host: 'github.acme.test' }
        },
        child: {
          type: 'issue',
          number: 7,
          repo: { owner: 'acme', repo: 'widgets', host: 'github.acme.test' }
        }
      }
    ])
  })

  it('uses the bounded cache and bypasses it with noCache', async () => {
    ghExecFileAsyncMock.mockResolvedValue({ stdout: '[]' })
    const issue = {
      id: 'issue:5',
      type: 'issue' as const,
      number: 5,
      title: 'Issue',
      state: 'open' as const,
      url: '',
      labels: [],
      updatedAt: '2026-08-29T00:00:00Z',
      author: null
    }
    const repo = { owner: 'acme', repo: 'widgets' }
    await fetchIssueDependencies([issue], repo)
    await fetchIssueDependencies([issue], repo)
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(2)
    await fetchIssueDependencies([issue], repo, {}, { noCache: true })
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(4)
  })

  it('keeps successful relations when one dependency direction fails', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ number: 3, repository_url: 'https://github.com/acme/widgets' }])
      })
      .mockRejectedValueOnce(new Error('HTTP 403: forbidden'))
    const issue = {
      id: 'issue:5',
      type: 'issue' as const,
      number: 5,
      title: 'Issue',
      state: 'open' as const,
      url: '',
      labels: [],
      updatedAt: '',
      author: null
    }
    const result = await fetchIssueDependencies([issue], { owner: 'acme', repo: 'widgets' })
    expect(result.items[0]?.dependencyRelations).toHaveLength(1)
    expect(result.error).toMatchObject({ type: 'unknown' })
  })

  it('parses P0-P3 labels into optional work-item priority', () => {
    expect(
      mapIssueWorkItem({ number: 1, labels: [{ name: 'P0' }, { name: 'bug' }] }).priority
    ).toBe(0)
    expect(mapIssueWorkItem({ number: 2, labels: [{ name: 'p3' }] }).priority).toBe(3)
    expect(mapIssueWorkItem({ number: 3, labels: [{ name: 'bug' }] }).priority).toBeUndefined()
  })

  it('keeps the issue when dependency lookup fails and does not query PRs', async () => {
    ghExecFileAsyncMock.mockRejectedValue(new Error('HTTP 403: forbidden'))
    const issue = {
      id: 'issue:5',
      type: 'issue' as const,
      number: 5,
      title: 'Issue',
      state: 'open' as const,
      url: '',
      labels: [],
      updatedAt: '',
      author: null
    }
    const pr = { ...issue, id: 'pr:7', type: 'pr' as const, number: 7 }
    const result = await fetchIssueDependencies([issue, pr], { owner: 'acme', repo: 'widgets' })
    expect(result.items).toEqual([issue, pr])
    expect(result.error).toMatchObject({ type: 'unknown' })
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(2)
    expect(
      ghExecFileAsyncMock.mock.calls.every(([args]) => String(args[3]).includes('/issues/5/'))
    ).toBe(true)
  })
})
