import { describe, expect, it } from 'vitest'
import type { GitHubWorkItem } from '../../../shared/github/work-item-types'
import {
  buildGitHubWorkItemDependencyTree,
  githubWorkItemDependencyIdentity
} from './github-work-item-dependency-tree'

const item = (number: number, overrides: Partial<GitHubWorkItem> = {}): GitHubWorkItem => ({
  id: `node-${number}`,
  type: 'issue',
  number,
  title: `Issue ${number}`,
  state: 'open',
  url: `https://github.com/acme/app/issues/${number}`,
  labels: [],
  updatedAt: `2026-01-${String(number).padStart(2, '0')}T00:00:00Z`,
  author: null,
  repoId: 'workspace-app',
  ...overrides
})

describe('buildGitHubWorkItemDependencyTree', () => {
  it('keeps legacy items without relations as top-level leaves', () => {
    const result = buildGitHubWorkItemDependencyTree([item(2), item(1)])

    expect(result.topLevel.map((node) => node.item.number)).toEqual([2, 1])
    expect(result.leafNodes.map((node) => node.item.number)).toEqual([2, 1])
    expect(result.branchNodes).toEqual([])
    expect(result.diagnostics).toEqual([])
  })

  it('builds branches and separates branch and leaf nodes', () => {
    const one = item(1)
    const two = item(2)
    const three = item(3)
    const result = buildGitHubWorkItemDependencyTree([one, two, three], {
      relations: [
        {
          parent: githubWorkItemDependencyIdentity(one),
          child: githubWorkItemDependencyIdentity(two)
        },
        {
          parent: githubWorkItemDependencyIdentity(two),
          child: githubWorkItemDependencyIdentity(three)
        }
      ]
    })

    expect(result.topLevel.map((node) => node.item.number)).toEqual([1])
    expect(result.topLevel[0].children[0].item.number).toBe(2)
    expect(result.branchNodes.map((node) => node.item.number)).toEqual([2, 1])
    expect(result.leafNodes.map((node) => node.item.number)).toEqual([3])
    expect(result.levels.map((level) => level.nodes.map((node) => node.item.number))).toEqual([
      [1],
      [2],
      [3]
    ])
    expect(result.parentsByIdentity.get(githubWorkItemDependencyIdentity(three))).toEqual([
      githubWorkItemDependencyIdentity(two)
    ])
    expect(result.childrenByIdentity.get(githubWorkItemDependencyIdentity(one))).toEqual([
      githubWorkItemDependencyIdentity(two)
    ])
  })

  it('uses item priority by default and explicit priorities as overrides', () => {
    const high = item(1, { priority: 2 })
    const low = item(2, { priority: 1 })
    const result = buildGitHubWorkItemDependencyTree([high, low])
    expect(result.topLevel.map((node) => node.item.number)).toEqual([2, 1])
    const overridden = buildGitHubWorkItemDependencyTree([high, low], {
      priorities: [{ identity: githubWorkItemDependencyIdentity(high), priority: 0 }]
    })
    expect(overridden.topLevel.map((node) => node.item.number)).toEqual([1, 2])
  })

  it('sorts each container by priority, then updatedAt and number', () => {
    const parent = item(10, { updatedAt: '2026-01-01T00:00:00Z' })
    const first = item(11, { updatedAt: '2026-03-01T00:00:00Z' })
    const second = item(12, { updatedAt: '2026-04-01T00:00:00Z' })
    const result = buildGitHubWorkItemDependencyTree([parent, first, second], {
      relations: [
        {
          parent: githubWorkItemDependencyIdentity(parent),
          child: githubWorkItemDependencyIdentity(first)
        },
        {
          parent: githubWorkItemDependencyIdentity(parent),
          child: githubWorkItemDependencyIdentity(second)
        }
      ],
      priorities: [
        { identity: githubWorkItemDependencyIdentity(first), priority: 2 },
        { identity: githubWorkItemDependencyIdentity(second), priority: 1 }
      ]
    })

    expect(result.topLevel[0].children.map((node) => node.item.number)).toEqual([12, 11])
    expect(
      buildGitHubWorkItemDependencyTree([item(4), item(3)]).topLevel.map((node) => node.item.number)
    ).toEqual([4, 3])
  })

  it('supports same-number items from different repositories', () => {
    const first = item(7, { issueRepo: { owner: 'acme', repo: 'one' } })
    const second = item(7, { issueRepo: { owner: 'acme', repo: 'two' } })
    const result = buildGitHubWorkItemDependencyTree([first, second], {
      relations: [
        {
          parent: { type: 'issue', number: 7, repo: { owner: 'acme', repo: 'one' } },
          child: { type: 'issue', number: 7, repo: { owner: 'acme', repo: 'two' } }
        }
      ]
    })

    expect(result.topLevel).toHaveLength(1)
    expect(result.topLevel[0].children[0].item.issueRepo?.repo).toBe('two')
  })

  it('reports missing, self and cyclic relations without producing unsafe links', () => {
    const first = item(1)
    const second = item(2)
    const firstId = githubWorkItemDependencyIdentity(first)
    const secondId = githubWorkItemDependencyIdentity(second)
    const result = buildGitHubWorkItemDependencyTree([first, second], {
      relations: [
        { parent: firstId, child: 'missing#issue:9' },
        { parent: firstId, child: firstId },
        { parent: firstId, child: secondId },
        { parent: secondId, child: firstId }
      ]
    })

    expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      'missing-relation-endpoint',
      'self-dependency',
      'cycle'
    ])
    expect(result.topLevel.map((node) => node.item.number)).toEqual([1])
    expect(result.topLevel[0].children.map((node) => node.item.number)).toEqual([2])
  })
})
