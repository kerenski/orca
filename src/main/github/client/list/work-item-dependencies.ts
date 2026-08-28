import type {
  GitHubWorkItemDependencyIdentity,
  GitHubWorkItemDependencyRelation
} from '../../../../shared/github/work-item-types'
import {
  acquire,
  classifyListIssuesError,
  ghExecFileAsync,
  release,
  type OwnerRepo
} from '../../gh-utils'
import { githubHostExecOptions, type GitHubRepoExecOptions } from '../../github-api-repository'
import type { MainWorkItem } from '../map/work-item-field-coercion'
import type { ClassifiedError } from '../../../../shared/classified-error'

type DependencyResult = {
  relations: GitHubWorkItemDependencyRelation[]
  error?: ClassifiedError
}

function identityFromDependency(
  value: Record<string, unknown>,
  fallback: OwnerRepo
): GitHubWorkItemDependencyIdentity | null {
  const number = typeof value.number === 'number' ? value.number : Number(value.number)
  if (!Number.isInteger(number) || number < 1) {
    return null
  }
  const repository = value.repository
  const repositoryRecord =
    typeof repository === 'object' && repository !== null
      ? (repository as Record<string, unknown>)
      : undefined
  let owner =
    typeof repositoryRecord?.owner === 'object' && repositoryRecord.owner !== null
      ? (repositoryRecord.owner as Record<string, unknown>).login
      : undefined
  let repo = repositoryRecord?.name
  if (typeof value.repository_url === 'string') {
    try {
      const parts = new URL(value.repository_url).pathname.split('/').filter(Boolean)
      if (parts.length >= 2) {
        owner = parts.at(-2)
        repo = parts.at(-1)
      }
    } catch {
      // Fall back to the repository object or request repository.
    }
  }
  return {
    type: 'issue',
    number,
    repo: {
      owner: typeof owner === 'string' && owner ? owner : fallback.owner,
      repo: typeof repo === 'string' && repo ? repo : fallback.repo,
      ...(fallback.host ? { host: fallback.host } : {})
    }
  }
}

function endpoint(
  ownerRepo: OwnerRepo,
  issueNumber: number,
  direction: 'blocked_by' | 'blocking'
): string {
  return `repos/${ownerRepo.owner}/${ownerRepo.repo}/issues/${issueNumber}/dependencies/${direction}`
}

async function requestDependencyEndpoint(
  ownerRepo: OwnerRepo,
  issueNumber: number,
  direction: 'blocked_by' | 'blocking',
  ghOptions: GitHubRepoExecOptions
): Promise<Record<string, unknown>[]> {
  await acquire()
  try {
    const { stdout } = await ghExecFileAsync(
      ['api', '--cache', '120s', `${endpoint(ownerRepo, issueNumber, direction)}?per_page=100`],
      { ...ghOptions, ...githubHostExecOptions(ownerRepo) }
    )
    const parsed: unknown = JSON.parse(stdout)
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
        )
      : []
  } finally {
    release()
  }
}

async function fetchOneIssueDependencies(
  issue: MainWorkItem,
  ownerRepo: OwnerRepo,
  ghOptions: GitHubRepoExecOptions
): Promise<DependencyResult> {
  const issueIdentity = identityFromDependency({ number: issue.number }, ownerRepo)
  if (!issueIdentity) {
    return { relations: [] }
  }
  const [blockedBy, blocking] = await Promise.all([
    requestDependencyEndpoint(ownerRepo, issue.number, 'blocked_by', ghOptions).then(
      (value) => ({ value }),
      (error) => ({ error })
    ),
    requestDependencyEndpoint(ownerRepo, issue.number, 'blocking', ghOptions).then(
      (value) => ({ value }),
      (error) => ({ error })
    )
  ])
  const relations: GitHubWorkItemDependencyRelation[] = []
  for (const dependency of 'value' in blockedBy ? blockedBy.value : []) {
    if ('pull_request' in dependency) {
      continue
    }
    const parent = identityFromDependency(dependency, ownerRepo)
    if (parent) {
      relations.push({ parent, child: issueIdentity })
    }
  }
  for (const dependency of 'value' in blocking ? blocking.value : []) {
    if ('pull_request' in dependency) {
      continue
    }
    const child = identityFromDependency(dependency, ownerRepo)
    if (child) {
      relations.push({ parent: issueIdentity, child })
    }
  }
  const failed = [blockedBy, blocking].find((result) => 'error' in result)
  if (failed && 'error' in failed) {
    const message = failed.error instanceof Error ? failed.error.message : String(failed.error)
    return { relations, error: classifyListIssuesError(message) }
  }
  return { relations }
}

export async function fetchIssueDependencies(
  issues: MainWorkItem[],
  ownerRepo: OwnerRepo,
  ghOptions: GitHubRepoExecOptions = {}
): Promise<{ items: MainWorkItem[]; error?: ClassifiedError }> {
  const results = await Promise.all(
    issues
      .filter((issue) => issue.type === 'issue')
      .map((issue) => fetchOneIssueDependencies(issue, ownerRepo, ghOptions))
  )
  let error: ClassifiedError | undefined
  let resultIndex = 0
  const items = issues.map((issue) => {
    if (issue.type !== 'issue') {
      return issue
    }
    const result = results[resultIndex++]
    if (result.error) {
      error ??= result.error
    }
    return result.relations.length > 0 ? { ...issue, dependencyRelations: result.relations } : issue
  })
  return { items, ...(error ? { error } : {}) }
}
