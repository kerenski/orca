import type { PRCheckDetail, PRCheckRunDetails } from '../../shared/github/check-types'
import type { GitHubIssueTimelineItem, PRComment } from '../../shared/github/comment-types'
import type { GitHubWorkItem, GitHubWorkItemDetails, ListWorkItemsResult } from '../../shared/github/work-item-types'
import type { WecirDevIssueReference } from '../../shared/wecir-dev/contracts'
import type {
  WecirDevGitHubCardData,
  WecirDevGitHubCardDataArgs,
  WecirDevGitHubCardItem,
  WecirDevGitHubCommentSummary,
  WecirDevGitHubCheckSummary,
  WecirDevGitHubItemError
} from '../../shared/wecir-dev/github-card-data'
import { WECIR_DEV_GITHUB_CARD_DATA_SCHEMA_VERSION } from '../../shared/wecir-dev/github-card-data'
import type { ClassifiedError } from '../../shared/classified-error'
import { classifyGhError } from './gh-error-classification'

export type {
  WecirDevGitHubCardData,
  WecirDevGitHubCardDataArgs,
  WecirDevGitHubCardItem,
  WecirDevGitHubCommentSummary,
  WecirDevGitHubCheckSummary,
  WecirDevGitHubItemError
} from '../../shared/wecir-dev/github-card-data'

export type WecirDevGitHubCardDataSource = {
  listWorkItems: (
    args: WecirDevGitHubCardDataArgs
  ) => Promise<ListWorkItemsResult<Omit<GitHubWorkItem, 'repoId'>>>
  getWorkItem: (
    number: number,
    type: GitHubWorkItem['type']
  ) => Promise<Omit<GitHubWorkItem, 'repoId'> | null>
  getWorkItemDetails: (
    number: number,
    type: GitHubWorkItem['type']
  ) => Promise<GitHubWorkItemDetails | null>
  getPRChecks: (
    number: number,
    headSha?: string,
    prRepo?: GitHubWorkItem['prRepo']
  ) => Promise<PRCheckDetail[]>
  getPRCheckDetails: (
    args: {
      checkRunId?: number
      workflowRunId?: number
      checkName?: string
      url?: string | null
      prRepo?: GitHubWorkItem['prRepo']
    }
  ) => Promise<PRCheckRunDetails | null>
}

function toReference(item: Pick<GitHubWorkItem, 'type' | 'number' | 'url' | 'title'>): WecirDevIssueReference {
  const [owner, repository] = item.url.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)/)?.slice(1) ?? []
  return {
    kind: item.type === 'pr' ? 'pull_request' : 'issue',
    number: item.number,
    owner: owner ?? '',
    repository: repository ?? '',
    ...(item.url ? { url: item.url } : {}),
    ...(item.title ? { title: item.title } : {})
  }
}

function commentsSummary(comments: PRComment[]): WecirDevGitHubCommentSummary {
  const authors = [...new Set(comments.map((comment) => comment.author).filter(Boolean))]
  const latest = comments.reduce<PRComment | null>(
    (current, comment) => (!current || comment.createdAt > current.createdAt ? comment : current),
    null
  )
  return {
    count: comments.length,
    authors,
    latestAt: latest?.createdAt ?? null,
    latestBody: latest?.body ?? null
  }
}

function linkedReferences(timeline: GitHubIssueTimelineItem[] | undefined): WecirDevIssueReference[] {
  if (!timeline) {
    return []
  }
  return timeline.flatMap((event) => {
    const target = event.event === 'cross-referenced' ? event.source : event.closer
    if (!target) {
      return []
    }
    return [
      {
        kind: target.type === 'pr' ? 'pull_request' : 'issue',
        number: target.number,
        owner: target.repository?.split('/')[0] ?? '',
        repository: target.repository?.split('/')[1] ?? '',
        ...(target.url ? { url: target.url } : {}),
        ...(target.title ? { title: target.title } : {})
      }
    ]
  })
}

function itemFromDetails(
  item: Omit<GitHubWorkItem, 'repoId'>,
  details: GitHubWorkItemDetails,
  checks: WecirDevGitHubCheckSummary[]
): WecirDevGitHubCardItem {
  const assignees = details.assignees ?? item.assignees?.map((assignee) => assignee.login) ?? []
  return {
    reference: toReference(item),
    title: item.title,
    body: details.body,
    labels: item.labels,
    assignees,
    milestone: item.milestone ?? null,
    state: item.state,
    updatedAt: item.updatedAt,
    draft: item.state === 'draft',
    author: item.author,
    references: linkedReferences(details.timelineItems),
    comments: commentsSummary(details.comments),
    checks
  }
}

function errorFromUnknown(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (lower.includes('authentication') || lower.includes('bad credentials') || lower.includes('http 401')) {
    return {
      type: 'permission_denied',
      message: 'GitHub authentication failed. Sign in again with gh auth login.'
    }
  }
  return classifyGhError(message)
}

export async function getWecirDevGitHubCardData(
  args: WecirDevGitHubCardDataArgs,
  source: WecirDevGitHubCardDataSource
): Promise<WecirDevGitHubCardData> {
  const limit = Math.min(Math.max(Math.floor(args.limit ?? 24), 1), 100)
  const page = Math.max(Math.floor(args.page ?? 1), 1)
  let listed: ListWorkItemsResult<Omit<GitHubWorkItem, 'repoId'>>
  try {
    listed = await source.listWorkItems({ ...args, limit, page })
  } catch (error) {
    return {
      schemaVersion: WECIR_DEV_GITHUB_CARD_DATA_SCHEMA_VERSION,
      items: [],
      itemErrors: [],
      listErrors: { issues: errorFromUnknown(error) },
      page,
      limit,
      hasNext: false
    }
  }

  const settled = await Promise.all(
    listed.items.map(async (listedItem): Promise<
      | { kind: 'item'; item: WecirDevGitHubCardItem }
      | { kind: 'error'; error: WecirDevGitHubItemError }
    > => {
      try {
        const item = (await source.getWorkItem(listedItem.number, listedItem.type)) ?? listedItem
        const details = await source.getWorkItemDetails(item.number, item.type)
        if (!details) {
          throw new Error(`GitHub ${item.type} #${item.number} was not found`)
        }
        let checks: WecirDevGitHubCheckSummary[] = []
        if (item.type === 'pr') {
          try {
            const checkRows = await source.getPRChecks(
              item.number,
              details.headSha ?? item.headSha,
              item.prRepo
            )
            const detailRows = await Promise.all(
              checkRows.slice(0, 20).map(async (check) => {
                try {
                  const detail = await source.getPRCheckDetails({
                    checkRunId: check.checkRunId,
                    workflowRunId: check.workflowRunId,
                    checkName: check.name,
                    url: check.url,
                    prRepo: item.prRepo
                  })
                  return { check, detail }
                } catch {
                  return { check, detail: null }
                }
              })
            )
            checks = detailRows.map(({ check, detail }) => ({
              name: check.name,
              status: check.status,
              conclusion: check.conclusion,
              ...(detail
                ? {
                    details: {
                      summary: detail.summary,
                      text: detail.text,
                      startedAt: detail.startedAt,
                      completedAt: detail.completedAt,
                      annotations: detail.annotations,
                      jobs: detail.jobs
                    }
                  }
                : {})
            }))
          } catch {
            checks = []
          }
        }
        return { kind: 'item', item: itemFromDetails(item, details, checks) }
      } catch (error) {
        return {
          kind: 'error',
          error: { number: listedItem.number, type: listedItem.type, error: errorFromUnknown(error) }
        }
      }
    })
  )
  const items = settled.filter((result): result is { kind: 'item'; item: WecirDevGitHubCardItem } => result.kind === 'item').map((result) => result.item)
  const itemErrors = settled.filter((result): result is { kind: 'error'; error: WecirDevGitHubItemError } => result.kind === 'error').map((result) => result.error)

  return {
    schemaVersion: WECIR_DEV_GITHUB_CARD_DATA_SCHEMA_VERSION,
    items,
    itemErrors,
    ...(listed.errors ? { listErrors: listed.errors } : {}),
    page,
    limit,
    hasNext: listed.items.length >= limit
  }
}

export const getWecirDevCardData = getWecirDevGitHubCardData
