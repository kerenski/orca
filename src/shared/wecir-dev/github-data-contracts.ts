import type { ClassifiedError } from '../classified-error'
import type { PRCheckDetail, PRCheckRunDetails } from '../github/check-types'
import type { GitHubOwnerRepo, GitHubRepositoryIdentity } from '../github/pull-request-types'
import type { GitHubIssueTimelineItem } from '../github/comment-types'
import type { IssueSourcePreference } from '../repo-types'
import type { TaskSourceContext } from '../task-source-context'

type WecirDevLocalGitOptions = { wslDistro?: string }

export type WecirDevGitHubRouting = {
  repoPath: string
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
  connectionId?: string | null
  localGitOptions?: WecirDevLocalGitOptions
  issueSourcePreference?: IssueSourcePreference
}

export type WecirDevGitHubListArgs = WecirDevGitHubRouting & {
  limit?: number
  query?: string
  page?: number
  noCache?: boolean
}

export type WecirDevGitHubItemArgs = WecirDevGitHubRouting & {
  number: number
  type?: 'issue' | 'pr'
  issueRepo?: GitHubRepositoryIdentity
  prRepo?: GitHubRepositoryIdentity
}

export type WecirDevGitHubCheckArgs = WecirDevGitHubRouting & {
  prNumber: number
  headSha?: string
  prRepo?: GitHubRepositoryIdentity | null
  noCache?: boolean
}

export type WecirDevGitHubCheckDetailsArgs = WecirDevGitHubRouting & {
  checkRunId?: number
  workflowRunId?: number
  checkName?: string
  url?: string | null
  prRepo?: GitHubRepositoryIdentity | null
}

export type WecirDevGitHubCommentSummary = {
  count: number
  latest?: {
    author: string
    createdAt: string
    body: string
  }
}

export type WecirDevGitHubItem = {
  id: string
  type: 'issue' | 'pr'
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged' | 'draft'
  draft: boolean
  labels: string[]
  assignees: string[]
  milestone?: string | null
  updatedAt: string
  author: string | null
  references: WecirDevGitHubReference[]
  comments: WecirDevGitHubCommentSummary
}

export type WecirDevGitHubReference = {
  kind: 'issue' | 'pr'
  number: number
  owner?: string
  repository?: string
  title?: string
  url?: string
}

export type WecirDevGitHubListResult = {
  items: WecirDevGitHubItem[]
  sources: {
    issues: GitHubOwnerRepo | null
    prs: GitHubOwnerRepo | null
    originCandidate: GitHubOwnerRepo | null
    upstreamCandidate: GitHubOwnerRepo | null
  }
  errors?: {
    issues?: ClassifiedError
    prs?: ClassifiedError
  }
  pagination: {
    page: number
    pageSize: number
    hasNext: boolean
    nextPage?: number
  }
}

export type WecirDevGitHubDetail = {
  item: WecirDevGitHubItem
  body: string
  comments: WecirDevGitHubCommentSummary
  references: WecirDevGitHubReference[]
  timelineItems: GitHubIssueTimelineItem[]
  checks: PRCheckDetail[]
}

export type WecirDevGitHubDetailError = {
  number: number
  type?: 'issue' | 'pr'
  error: ClassifiedError
}

export type WecirDevGitHubBatchDetailsResult = {
  items: WecirDevGitHubDetail[]
  errors: WecirDevGitHubDetailError[]
}

export type WecirDevGitHubCheckResult = PRCheckDetail[]
export type WecirDevGitHubCheckDetailsResult = PRCheckRunDetails | null

// These are intentionally projections, not provider response types: credentials and headers
// can never cross the adapter boundary.
export type WecirDevGitHubPublicData =
  | WecirDevGitHubItem
  | WecirDevGitHubDetail
  | WecirDevGitHubCheckResult
  | WecirDevGitHubCheckDetailsResult
