import type { PRComment } from '../../shared/github/comment-types'
import type { ClassifiedError } from '../../shared/classified-error'
import type { PRCheckDetail } from '../../shared/github/check-types'
import type { ListWorkItemsResult } from '../../shared/github/work-item-types'
import type { MainWorkItem } from '../github/client/map/work-item-field-coercion'
import {
  getPRCheckDetails,
  getPRChecks,
  getWorkItemByOwnerRepoOutcome,
  getWorkItemOutcome,
  listWorkItems
} from '../github/client'
import { classifyGhError, type LocalGitExecOptions } from '../github/gh-utils'
import { getWorkItemDetails } from '../github/work-item-details'
import type {
  WecirDevGitHubBatchDetailsResult,
  WecirDevGitHubCheckDetailsArgs,
  WecirDevGitHubCheckDetailsResult,
  WecirDevGitHubCheckArgs,
  WecirDevGitHubDetail,
  WecirDevGitHubDetailError,
  WecirDevGitHubItem,
  WecirDevGitHubItemArgs,
  WecirDevGitHubListArgs,
  WecirDevGitHubListResult,
  WecirDevGitHubReference
} from '../../shared/wecir-dev/github-data-contracts'

function safeError(error: unknown): ClassifiedError {
  const classified =
    typeof error === 'object' && error !== null && 'type' in error && 'message' in error
      ? (error as ClassifiedError)
      : classifyGhError(error instanceof Error ? error.message : String(error))
  const rawMessage = classified.message
  return {
    type: /work item (?:was )?not found|details were not found/i.test(rawMessage)
      ? 'not_found'
      : classified.type,
    message: rawMessage
      .replace(/(authorization|cookie|token|password|secret)\s*[:=]\s*\S+/gi, '[redacted]')
      .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[redacted]')
  }
}

function commentSummary(comments: PRComment[]): WecirDevGitHubItem['comments'] {
  const latest = comments.at(-1)
  return {
    count: comments.length,
    ...(latest
      ? {
          latest: {
            author: latest.author,
            createdAt: latest.createdAt,
            body: latest.body
          }
        }
      : {})
  }
}

function referencesFromTimeline(
  timelineItems: NonNullable<Awaited<ReturnType<typeof getWorkItemDetails>>>['timelineItems']
): WecirDevGitHubReference[] {
  return (timelineItems ?? [])
    .filter((event) => event.event === 'cross-referenced' && event.source)
    .map((event) => ({
      kind: event.source!.type === 'pr' ? 'pr' : 'issue',
      number: event.source!.number,
      title: event.source!.title,
      url: event.source!.url,
      ...(event.source!.repository ? { repository: event.source!.repository } : {})
    }))
}

function projectItem(item: MainWorkItem): WecirDevGitHubItem {
  const assignees = (item.assignees ?? []).map((assignee) => assignee.login)
  const milestone = 'milestone' in item ? item.milestone : undefined
  return {
    id: item.id,
    type: item.type,
    number: item.number,
    title: item.title,
    url: item.url,
    state: item.state,
    draft: item.state === 'draft',
    labels: item.labels,
    assignees,
    ...(typeof milestone === 'string' || milestone === null ? { milestone } : {}),
    updatedAt: item.updatedAt,
    author: item.author,
    references: [],
    comments: { count: 0 }
  }
}

function detailProjection(
  item: MainWorkItem,
  details: NonNullable<Awaited<ReturnType<typeof getWorkItemDetails>>>
): WecirDevGitHubDetail {
  const references = referencesFromTimeline(details.timelineItems)
  const projected = projectItem(item)
  return {
    item: { ...projected, references, comments: commentSummary(details.comments) },
    body: details.body,
    comments: commentSummary(details.comments),
    references,
    timelineItems: details.timelineItems ?? [],
    checks: details.checks ?? []
  }
}

export async function listGitHubData(
  args: WecirDevGitHubListArgs
): Promise<WecirDevGitHubListResult> {
  const page = typeof args.page === 'number' && args.page >= 1 ? Math.floor(args.page) : 1
  const pageSize = args.limit ?? 24
  const result: ListWorkItemsResult<MainWorkItem> = await listWorkItems(
    args.repoPath,
    pageSize,
    args.query,
    page,
    args.issueSourcePreference,
    args.connectionId,
    args.noCache,
    (args.localGitOptions ?? {}) as LocalGitExecOptions
  )
  const hasNext = Boolean(result.pagination?.issuesHasNext || result.pagination?.prsHasNext)
  return {
    items: result.items.map(projectItem),
    sources: result.sources,
    ...(result.errors ? { errors: result.errors } : {}),
    pagination: { page, pageSize, hasNext, ...(hasNext ? { nextPage: page + 1 } : {}) }
  }
}

async function readAdapterItem(args: WecirDevGitHubItemArgs) {
  const localGitOptions = (args.localGitOptions ?? {}) as LocalGitExecOptions
  const resolvedType = args.type ?? (args.issueRepo ? 'issue' : args.prRepo ? 'pr' : undefined)
  const explicitRepo =
    resolvedType === 'issue' ? args.issueRepo : resolvedType === 'pr' ? args.prRepo : undefined
  return explicitRepo
    ? getWorkItemByOwnerRepoOutcome(
        args.repoPath,
        explicitRepo,
        args.number,
        resolvedType as 'issue' | 'pr',
        args.connectionId,
        localGitOptions
      )
    : getWorkItemOutcome(
        args.repoPath,
        args.number,
        args.type,
        args.connectionId,
        localGitOptions,
        args.issueSourcePreference
      )
}

export async function getGitHubData(
  args: WecirDevGitHubItemArgs
): Promise<WecirDevGitHubDetail | null> {
  const outcome = await readAdapterItem(args)
  if (outcome.error) {
    throw safeError(outcome.error)
  }
  const { item } = outcome
  if (!item) {
    return null
  }
  try {
    const details = await getWorkItemDetails(
      args.repoPath,
      args.number,
      item.type,
      args.connectionId,
      (args.localGitOptions ?? {}) as LocalGitExecOptions,
      args.issueSourcePreference,
      item.issueRepo,
      item.prRepo
    )
    return details ? detailProjection(item, details) : null
  } catch (error) {
    throw safeError(error)
  }
}

export async function getGitHubDataBatch(
  args: WecirDevGitHubItemArgs[]
): Promise<WecirDevGitHubBatchDetailsResult> {
  const settled = await Promise.allSettled(
    args.map(async (itemArgs) => {
      const outcome = await readAdapterItem(itemArgs)
      const item = outcome.item
      if (!item) {
        throw outcome.error ?? new Error('GitHub work item was not found')
      }
      const details = await getWorkItemDetails(
        itemArgs.repoPath,
        itemArgs.number,
        item.type,
        itemArgs.connectionId,
        (itemArgs.localGitOptions ?? {}) as LocalGitExecOptions,
        itemArgs.issueSourcePreference,
        item.issueRepo,
        item.prRepo
      )
      if (!details) {
        throw new Error('GitHub work item details were not found')
      }
      return detailProjection(item, details)
    })
  )
  const items: WecirDevGitHubDetail[] = []
  const errors: WecirDevGitHubDetailError[] = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(result.value)
    } else {
      errors.push({
        number: args[index].number,
        ...(args[index].type ? { type: args[index].type } : {}),
        error: safeError(result.reason)
      })
    }
  })
  return { items, errors }
}

export async function getGitHubChecks(args: WecirDevGitHubCheckArgs): Promise<PRCheckDetail[]> {
  return getPRChecks(
    args.repoPath,
    args.prNumber,
    args.headSha,
    args.prRepo ?? null,
    { noCache: args.noCache },
    args.connectionId,
    (args.localGitOptions ?? {}) as LocalGitExecOptions
  )
}

export async function getGitHubCheckDetails(
  args: WecirDevGitHubCheckDetailsArgs
): Promise<WecirDevGitHubCheckDetailsResult> {
  return getPRCheckDetails(
    args.repoPath,
    {
      checkRunId: args.checkRunId,
      workflowRunId: args.workflowRunId,
      checkName: args.checkName,
      url: args.url,
      prRepo: args.prRepo ?? null
    },
    args.connectionId,
    (args.localGitOptions ?? {}) as LocalGitExecOptions
  )
}
