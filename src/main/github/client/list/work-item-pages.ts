import type { ClassifiedError } from '../../../../shared/classified-error'
import { classifyGitHubUnavailable } from '../../../../shared/github/api-availability'
import { parseTaskQuery, type ParsedTaskQuery } from '../../../../shared/task-query'
import { sortWorkItemsByNumber } from '../../../../shared/work-items'
import {
  ghExecFileAsync,
  classifyListIssuesError,
  classifyListPrsError,
  ghRepoExecOptions,
  githubRepoContext,
  type LocalGitExecOptions,
  type OwnerRepo
} from '../../gh-utils'
import { githubHostExecOptions } from '../../github-api-repository'
import { githubPRStackExecutionScope } from './../github-exec-scope'
import { hydrateWorkItemRepositoryMergeMetadata } from './../detect/hydrate-work-item-merge-metadata'
import type { MainWorkItem } from './../map/work-item-field-coercion'
import { mapIssueWorkItem, mapPullRequestWorkItem } from './../map/work-item'
import {
  buildWorkItemListRequest,
  assertSshRepoHasResolvedGitHubSource,
  type PartialWorkItemsResult
} from './work-item-list-request'

type IssueSearchPayload = {
  items?: Record<string, unknown>[]
  total_count?: number
  incomplete_results?: boolean
}

function parseIssueSearchPayload(stdout: string): IssueSearchPayload {
  const parsed = JSON.parse(stdout) as Record<string, unknown>[] | IssueSearchPayload
  return Array.isArray(parsed) ? { items: parsed } : parsed
}

export async function listRecentWorkItems(
  repoPath: string,
  issueOwnerRepo: OwnerRepo | null,
  prOwnerRepo: OwnerRepo | null,
  limit: number,
  page: number,
  connectionId?: string | null,
  noCache?: boolean,
  localGitOptions: LocalGitExecOptions = {}
): Promise<PartialWorkItemsResult> {
  const ghOptions = ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions))
  assertSshRepoHasResolvedGitHubSource({ connectionId, issueOwnerRepo, prOwnerRepo })
  const recentQuery = parseTaskQuery('is:open')
  const issueRequest = issueOwnerRepo
    ? buildWorkItemListRequest({
        kind: 'issue',
        ownerRepo: issueOwnerRepo,
        limit,
        query: recentQuery,
        page
      })
    : null
  const prRequest = prOwnerRepo
    ? buildWorkItemListRequest({
        kind: 'pr',
        ownerRepo: prOwnerRepo,
        limit,
        query: recentQuery,
        page
      })
    : null
  if (noCache && issueRequest) {
    issueRequest.args.splice(1, 2)
  }
  // Why: unresolved sources must stay empty — an unscoped Search API would return other public repos' issues (#9660).
  // Why: allSettled so a 403 on the issue side doesn't zero the PR half (partial results + banner).
  const [issuesSettled, prsSettled] = await Promise.allSettled([
    issueRequest && issueOwnerRepo
      ? ghExecFileAsync(issueRequest.args, {
          ...ghOptions,
          ...githubHostExecOptions(issueOwnerRepo)
        })
      : Promise.resolve({ stdout: '[]' }),
    prRequest && prOwnerRepo
      ? ghExecFileAsync(prRequest.args, {
          ...ghOptions,
          ...githubHostExecOptions(prOwnerRepo)
        })
      : Promise.resolve({ stdout: '[]' })
  ])

  let issues: MainWorkItem[] = []
  let issuesError: ClassifiedError | undefined
  let issuesHasNext = false
  if (issuesSettled.status === 'fulfilled') {
    try {
      const payload = parseIssueSearchPayload(issuesSettled.value.stdout)
      issues = (payload.items ?? [])
        // Why: search/issues can still return PRs (pull_request marker) even with is:issue; filter them out.
        .filter((item) => !('pull_request' in item))
        .map((item) => mapIssueWorkItem(item, issueOwnerRepo))
      issuesHasNext =
        typeof payload.total_count === 'number'
          ? page * limit < payload.total_count || payload.incomplete_results === true
          : false
    } catch (err) {
      // Why: a malformed issue payload must not discard the successfully fetched PR half.
      issuesError = classifyListIssuesError(err instanceof Error ? err.message : String(err))
    }
  } else {
    const stderr =
      issuesSettled.reason instanceof Error
        ? issuesSettled.reason.message
        : String(issuesSettled.reason)
    issuesError = classifyListIssuesError(stderr)
  }

  let prs: MainWorkItem[] = []
  let prsError: ClassifiedError | undefined
  let prsHasNext = false
  if (prsSettled.status === 'fulfilled') {
    const rawPrs = JSON.parse(prsSettled.value.stdout) as Record<string, unknown>[]
    const offset = prRequest?.offset ?? 0
    prsHasNext = rawPrs.length > offset + limit || (rawPrs.length === limit && offset === 0)
    prs = rawPrs
      .slice(offset, offset + limit)
      .map((item) => mapPullRequestWorkItem(item, prOwnerRepo))
    prs = await hydrateWorkItemRepositoryMergeMetadata(
      prs,
      prOwnerRepo,
      { ...ghOptions, ...githubHostExecOptions(prOwnerRepo) },
      githubPRStackExecutionScope(connectionId, localGitOptions)
    )
  } else {
    const stderr =
      prsSettled.reason instanceof Error ? prsSettled.reason.message : String(prsSettled.reason)
    // Keep the successful issue side when PR listing fails.
    prsError = classifyListPrsError(stderr)
  }

  return {
    items: sortWorkItemsByNumber([...issues, ...prs]).slice(0, limit),
    issuesError,
    prsError,
    issuesHasNext,
    prsHasNext
  }
}

export async function listQueriedWorkItems(
  repoPath: string,
  issueOwnerRepo: OwnerRepo | null,
  prOwnerRepo: OwnerRepo | null,
  query: ParsedTaskQuery,
  limit: number,
  page?: number,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<PartialWorkItemsResult> {
  const ghOptions = ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions))
  assertSshRepoHasResolvedGitHubSource({ connectionId, issueOwnerRepo, prOwnerRepo })
  const hasPrOnlyFilter =
    query.state === 'merged' ||
    query.draft ||
    query.reviewRequested !== null ||
    query.reviewedBy !== null
  const issueScope = query.scope !== 'pr' && !hasPrOnlyFilter
  const prScope = query.scope !== 'issue'
  let successfulRequestCount = 0
  let nonAvailabilityFailureCount = 0
  let availabilityError: unknown
  let prsError: ClassifiedError | undefined
  let prsHasNext = false

  // Why: surface the issue-side error separately for the IPC envelope; PR-side keeps prior swallow-and-log (parent doc §6).
  const issueFetch = (async (): Promise<PartialWorkItemsResult> => {
    if (!issueScope) {
      return { items: [] }
    }
    if (!issueOwnerRepo) {
      return { items: [] }
    }
    const request = buildWorkItemListRequest({
      kind: 'issue',
      ownerRepo: issueOwnerRepo,
      limit,
      query,
      page: page ?? 1
    })
    try {
      const { stdout } = await ghExecFileAsync(request.args, {
        ...ghOptions,
        ...githubHostExecOptions(issueOwnerRepo)
      })
      const payload = parseIssueSearchPayload(stdout)
      const items = (payload.items ?? [])
        .filter((item) => !('pull_request' in item))
        .map((item) => mapIssueWorkItem(item, issueOwnerRepo))
      const requestedPage = page ?? 1
      successfulRequestCount += 1
      return {
        items,
        issuesHasNext:
          typeof payload.total_count === 'number'
            ? requestedPage * limit < payload.total_count || payload.incomplete_results === true
            : false
      }
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err)
      if (classifyGitHubUnavailable(stderr)) {
        availabilityError ??= err
      } else {
        nonAvailabilityFailureCount += 1
      }
      return { items: [], issuesError: classifyListIssuesError(stderr) }
    }
  })()

  const prFetch = (async (): Promise<PartialWorkItemsResult> => {
    if (!prScope) {
      return { items: [] }
    }
    if (!prOwnerRepo) {
      return { items: [] }
    }
    const request = buildWorkItemListRequest({
      kind: 'pr',
      ownerRepo: prOwnerRepo,
      limit,
      query,
      page: page ?? 1
    })
    try {
      const { stdout } = await ghExecFileAsync(request.args, {
        ...ghOptions,
        ...githubHostExecOptions(prOwnerRepo)
      })
      const rawPrs = JSON.parse(stdout) as Record<string, unknown>[]
      const requestedPage = page ?? 1
      prsHasNext =
        rawPrs.length > request.offset + limit ||
        (rawPrs.length === Math.min(requestedPage * limit, 1000) && rawPrs.length < 1000)
      const mapped = rawPrs
        .slice(request.offset, request.offset + limit)
        .map((item) => mapPullRequestWorkItem(item, prOwnerRepo))
      const hydrated = await hydrateWorkItemRepositoryMergeMetadata(
        mapped,
        prOwnerRepo,
        { ...ghOptions, ...githubHostExecOptions(prOwnerRepo) },
        githubPRStackExecutionScope(connectionId, localGitOptions)
      )
      successfulRequestCount += 1
      if (query.state === 'closed') {
        return { items: hydrated.filter((item) => item.state !== 'merged'), prsHasNext }
      }
      return { items: hydrated, prsHasNext }
    } catch (err) {
      console.warn('listQueriedWorkItems PRs partial failure:', err)
      const stderr = err instanceof Error ? err.message : String(err)
      prsError = classifyListPrsError(stderr)
      if (classifyGitHubUnavailable(stderr)) {
        availabilityError ??= err
      } else {
        nonAvailabilityFailureCount += 1
      }
      return { items: [], prsHasNext: false }
    }
  })()

  const [issueResult, prResult] = await Promise.all([issueFetch, prFetch])
  if (availabilityError && successfulRequestCount === 0 && nonAvailabilityFailureCount === 0) {
    // Why: when every half hit the same availability failure, propagate it so Tasks can distinguish an outage from no data.
    throw availabilityError
  }
  return {
    items: sortWorkItemsByNumber([...issueResult.items, ...prResult.items]).slice(0, limit),
    issuesError: issueResult.issuesError,
    prsError,
    issuesHasNext: issueResult.issuesHasNext,
    prsHasNext: prResult.prsHasNext
  }
}
