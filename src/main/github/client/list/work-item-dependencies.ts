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

type DependencyFetchOptions = {
  noCache?: boolean
  cacheScope?: string | null
}

type DependencyCacheEntry = {
  updatedAt: string
  result: DependencyResult
  expiresAt: number
  sequence: number
}

const DEPENDENCY_CACHE_TTL_MS = 90_000
const DEPENDENCY_CACHE_MAX_ENTRIES = 256
const dependencyCache = new Map<string, DependencyCacheEntry>()
let dependencyCacheSequence = 0

function dependencyCacheKey(
  ownerRepo: OwnerRepo,
  issueNumber: number,
  cacheScope?: string | null
): string {
  return [
    cacheScope ?? 'local',
    ownerRepo.host ?? 'github.com',
    ownerRepo.owner,
    ownerRepo.repo,
    issueNumber
  ].join('\\0')
}

function readDependencyCache(
  key: string,
  updatedAt: string,
  noCache?: boolean
): DependencyResult | undefined {
  if (noCache) {
    return undefined
  }
  const entry = dependencyCache.get(key)
  if (!entry || entry.expiresAt <= Date.now() || entry.updatedAt !== updatedAt) {
    if (entry) {
      dependencyCache.delete(key)
    }
    return undefined
  }
  entry.sequence = ++dependencyCacheSequence
  return entry.result
}

function writeDependencyCache(key: string, updatedAt: string, result: DependencyResult): void {
  dependencyCache.set(key, {
    updatedAt,
    result,
    expiresAt: Date.now() + DEPENDENCY_CACHE_TTL_MS,
    sequence: ++dependencyCacheSequence
  })
  while (dependencyCache.size > DEPENDENCY_CACHE_MAX_ENTRIES) {
    const oldest = [...dependencyCache.entries()].reduce((candidate, entry) =>
      entry[1].sequence < candidate[1].sequence ? entry : candidate
    )
    dependencyCache.delete(oldest[0])
  }
}

export function _resetIssueDependencyCacheForTests(): void {
  dependencyCache.clear()
  dependencyCacheSequence = 0
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
  ghOptions: GitHubRepoExecOptions,
  noCache?: boolean
): Promise<Record<string, unknown>[]> {
  await acquire()
  try {
    const args = ['api']
    if (!noCache) {
      args.push('--cache', '120s')
    }
    args.push(`${endpoint(ownerRepo, issueNumber, direction)}?per_page=100`)
    const { stdout } = await ghExecFileAsync(args, {
      ...ghOptions,
      ...githubHostExecOptions(ownerRepo)
    })
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
  ghOptions: GitHubRepoExecOptions,
  options: DependencyFetchOptions = {}
): Promise<DependencyResult> {
  const issueIdentity = identityFromDependency({ number: issue.number }, ownerRepo)
  if (!issueIdentity) {
    return { relations: [] }
  }
  const key = dependencyCacheKey(ownerRepo, issue.number, options.cacheScope)
  const cached = readDependencyCache(key, issue.updatedAt, options.noCache)
  if (cached) {
    return cached
  }
  const [blockedBy, blocking] = await Promise.all([
    requestDependencyEndpoint(
      ownerRepo,
      issue.number,
      'blocked_by',
      ghOptions,
      options.noCache
    ).then(
      (value) => ({ value }),
      (error) => ({ error })
    ),
    requestDependencyEndpoint(ownerRepo, issue.number, 'blocking', ghOptions, options.noCache).then(
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
  let result: DependencyResult = { relations }
  if (failed && 'error' in failed) {
    const message = failed.error instanceof Error ? failed.error.message : String(failed.error)
    result = { relations, error: classifyListIssuesError(message) }
  }
  if (!options.noCache) {
    writeDependencyCache(key, issue.updatedAt, result)
  }
  return result
}

export async function fetchIssueDependencies(
  issues: MainWorkItem[],
  ownerRepo: OwnerRepo,
  ghOptions: GitHubRepoExecOptions = {},
  options: DependencyFetchOptions = {}
): Promise<{ items: MainWorkItem[]; error?: ClassifiedError }> {
  const issueItems = issues.filter((issue) => issue.type === 'issue')
  const results: DependencyResult[] = Array.from({ length: issueItems.length })
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++
      if (index >= issueItems.length) {
        return
      }
      results[index] = await fetchOneIssueDependencies(
        issueItems[index],
        ownerRepo,
        ghOptions,
        options
      )
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, issueItems.length) }, () => worker()))
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
